import AES from 'crypto-js/aes';
import Utf8 from 'crypto-js/enc-utf8';
import { Client as NetworkClient, ClientFactory } from 'zeropool-support-js';
import { AccountConfig, ClientConfig, ProverMode,
         ZkBobClient, HistoryRecord, ComplianceHistoryRecord,
         TransferConfig, TransferRequest, FeeAmount, TxType,
         PoolLimits, TreeState, EphemeralAddress, SyncStat, TreeNode,
         ServiceVersion, accountId, DepositType, SignatureType,
         deriveSpendingKeyZkBob, GiftCardProperties,
         ClientStateCallback, DirectDeposit
        } from 'zkbob-client-js';
import bip39 from 'bip39-light';
import HDWalletProvider from '@truffle/hdwallet-provider';
import { v4 as uuidv4 } from 'uuid';
import { env } from './environment';
import { DirectDepositType } from 'zkbob-client-js/lib/dd';
import { PreparedTransaction } from 'zkbob-client-js/lib/networks';

const PERMIT2_CONTRACT = '0x000000000022D473030F116dDEE9F6B43aC78BA3';


interface AccountStorage {
    get(accountName: string, field: string): string | null;
    set(accountName: string, field: string, value: string);
}

class LocalAccountStorage implements AccountStorage {
    get(accountName: string, field: string): string | null {
        return localStorage.getItem(`zconsole.${accountName}.${field}`);
    }
    set(accountName: string, field: string, value: string) {
        localStorage.setItem(`zconsole.${accountName}.${field}`, value);
    }
}

export enum InitAccountState {
    ClientInitializing = 1,
    AccountlessClientReady = 2,
    AccountInitializing = 3,
    FullClientReady = 4,
    Failed = 5
}

export interface InitAccountStatus {
    state: InitAccountState;
    error?: Error | undefined;
}

export type InitAccountCallback = (status: InitAccountStatus) => void;

export class Account {
    accountName?: string;
    private storage: AccountStorage;
    public provider?: HDWalletProvider;
    public client?: NetworkClient;
    private zpClient?: ZkBobClient;
    private zpClientPromise?: Promise<ZkBobClient>;
    private initError?: Error;
    private tokenSymbols: {[poolName: string]: string} = {};

    private config: ClientConfig;

    public initCallback?: InitAccountCallback;
    
    public accountId: string;
    public supportId: string;

    constructor(callback?: InitAccountCallback) {
        this.initCallback = callback;
        this.storage = new LocalAccountStorage();
        
        this.supportId = uuidv4();

        this.config = {
            pools: env.pools,
            chains: env.chains,
            snarkParams: env.globalSnarks,
            supportId: this.supportId,
            forcedMultithreading: undefined,
        };

        if (this.initCallback) this.initCallback({ state: InitAccountState.ClientInitializing });

        this.zpClientPromise = ZkBobClient.create(this.config, env.defaultPool);

        this.zpClientPromise.then((zpClient) => {
            this.zpClient = zpClient;
            this.initError = undefined;
            if (this.initCallback) this.initCallback({ state: InitAccountState.AccountlessClientReady });
        }).catch((err) => {
            console.error(`Cannot initialize zk client: ${err.message}`);
            this.zpClient = undefined;
            this.initError = err;
            if (this.initCallback) this.initCallback({ state: InitAccountState.Failed, error: err });
        }).finally(() => {
            this.zpClientPromise = undefined;
        });
    }

    public async attachAccount(
        accountName: string,
        mnemonic: string,
        password: string,
        isNewAcc: boolean,
    ): Promise<void> {

        // waiting when accountless client will initialized (or failed)
        await this.zpClientPromise;

        if (this.initCallback) this.initCallback({ state: InitAccountState.AccountInitializing });

        if (!this.zpClient) {
            if (this.initCallback) this.initCallback({ state: InitAccountState.Failed, error: this.initError });
            return;
        }

        const sk = deriveSpendingKeyZkBob(mnemonic);
        const pool = await this.getCurrentPool();
        const birthindex = isNewAcc ? -1 : undefined;
        const proverMode = this.getZpClient().getProverMode();
        const accountConf: AccountConfig = { sk, pool, birthindex, proverMode };

        this.createL1Client(pool, mnemonic);
        
        try {
            await this.zpClient?.login(accountConf);
            this.accountId = accountId(accountConf);
        } catch (err) {
            this.initError = err;
            if (this.initCallback) this.initCallback({ state: InitAccountState.Failed, error: err });
            return;
        }

        this.initError = undefined;
        if (this.initCallback) this.initCallback({ state: InitAccountState.FullClientReady });

        this.storage.set(accountName, 'seed', await AES.encrypt(mnemonic, password).toString());
        this.accountName = accountName;
    }

    public async attachExistingAccount(
        accountName: string,
        password: string,
    ) {
        let seed = this.decryptSeed(accountName, password);
        await this.attachAccount(accountName, seed, password, false);
    }

    public async detachAccount() {
        if (!this.zpClient) {
            return;
        }

        await this.zpClient.logout();
        this.accountName = undefined;
        this.accountId = '';

        this.killL1Client();
    }

    private async createL1Client(poolName: string, mnemonic: string) {
        // Initialize L1 network client (to interact with the native blockchain)
        if(this.client) {
            const curChainId = await this.getClient().getChainId();
            const newChainId = env.pools[poolName].chainId;
            if (newChainId != curChainId) {
                this.killL1Client();
            }
        }

        if (!this.client) {
            const curChainId = String(env.pools[poolName].chainId);
            const rpcURLs = env.chains[curChainId].rpcUrls;
            const transactionUrl = env.blockExplorerUrls[curChainId].tx;

            /*this.provider = new HDWalletProvider({
                mnemonic,
                providerOrUrl: rpcURLs[0],  // TODO: check URL count
            });
            
            const client = new EthereumClient(this.provider, { transactionUrl });
            client.gasMultiplier = 1.2; // increase default gas*/
            //chainId: number, rpcUrl: string, mnemonic: string, config: Config
            this.client = ClientFactory.createClient(Number(curChainId), rpcURLs[0], mnemonic, { transactionUrl });
        }

        // Request token symbol if needed
        let attemptsNum = 3;
        while(!this.tokenSymbols[poolName] && attemptsNum-- > 0) {
            try {
                this.tokenSymbols[poolName] = await this.client.getTokenName(env.pools[poolName].tokenAddress);
                console.log(`Retrieved token symbol for ${poolName}: ${this.tokenSymbols[poolName]}`)
            } catch(err) {
                console.warn(`Cannot retrieve token symbol for ${poolName}: ${err.message}`);
            }
        }
    }

    private async killL1Client() {
        this.client?.haltClient();
        delete this.client;
    }

    public getCurrentPool(): string {
        return this.getZpClient().currentPool();
    }

    public getPools(): string[] {
        return this.getZpClient().availabePools();
    }

    public getTokenAddr(): string {
        return env.pools[this.getCurrentPool()].tokenAddress;
    }

    public getPoolAddr(): string {
        return env.pools[this.getCurrentPool()].poolAddress;
    }

    public getDelegatedProverUrls(): string[] {
        return env.pools[this.getCurrentPool()].delegatedProverUrls
    }

    public tokenSymbol(timestamp: number | undefined = undefined): string {
        if (timestamp !== undefined) {
            const migrationConf = env.migrations[this.getCurrentPool()];
            if (migrationConf) {
                const oldTokens = migrationConf.oldTokens;
                if (oldTokens) {
                    for (const oldTokenName of Object.keys(oldTokens)) {
                        const oldConfig = oldTokens[oldTokenName];
                        if (timestamp >= (oldConfig.firstTimestamp ?? 0) &&
                            timestamp < oldConfig.lastTimestamp) 
                        {
                            return oldTokenName;
                        }
                    }
                }
            }
        }

        return this.tokenSymbols[this.getCurrentPool()] ?? 'UNK';
    }
    
    public shTokenSymbol(timestamp: number | undefined = undefined): string {
        return `sh${this.tokenSymbol(timestamp)}`;
    }

    public depositScheme(): DepositType {
        return this.config.pools[this.getCurrentPool()].depositScheme;
    }

    public async switchPool(poolAlias: string, password: string): Promise<void> {
        if (!this.accountName) {
            throw new Error('Cannot switch pool: account isn\'t set');
        }

        const mnemonic = this.decryptSeed(this.accountName, password)
        await this.createL1Client(poolAlias, mnemonic);
        return this.getZpClient().switchToPool(poolAlias);
    }

    public getSeed(accountName: string, password: string): string {
        return this.decryptSeed(accountName, password);
    }

    private decryptSeed(accountName: string, password: string): string {
        const cipherText = this.storage.get(accountName, 'seed');
        let seed;
        try {
            seed = AES.decrypt(cipherText, password).toString(Utf8);
            if (!bip39.validateMnemonic(seed)) throw new Error('invalid mnemonic');
        } catch (_) {
            throw new Error('Incorrect password');
        }

        return seed;
    }

    public isInitialized(): boolean {
        return !!this.client;
    }

    public hasActiveAccount(): boolean {
        return (this.zpClient !== undefined && this.zpClient.hasAccount() && this.accountName !== undefined);
    }

    public isAccountPresent(accountName: string): boolean {
        return !!this.storage.get(accountName, 'seed');
    }

    private getClient(): NetworkClient {
        if (!this.client) {
            const errMsg = this.initError ? `(client init failed: ${this.initError.message})` : '(unknown error)';
            throw new Error(`NetworkClient is not ready currently (internal error)`);
        }
        return this.client;
    }

    private getZpClient(): ZkBobClient {
        if (!this.zpClient) {
            const errMsg = this.initError ? `(client init failed: ${this.initError.message})` : '(unknown error)';
            throw new Error(`ZkAccount is not ready currently ${errMsg}`);
        }
        return this.zpClient;
    }

    public networkName(): string {
        return this.getZpClient().networkName();
    }

    public nativeSymbol(): string {
        switch(this.networkName()) {
            case 'ethereum': return 'ETH';
            case 'xdai': return 'XDAI';
            case 'aurora': return 'AURORA';
            case 'near': return 'NEAR';
            case 'waves': return 'WAVES';
            case 'polkadot': return 'DOT';
            case 'kusama': return 'KSM';
            case 'polygon': return 'MATIC';
            case 'sepolia': return 'ETH';
            case 'goerli': return 'ETH';
            case 'tron': return 'TRX';
            case 'shasta': return 'TRX';
            default: return '';
        }
    }

    public async getRegularAddress(): Promise<string> {
        return await this.getClient().getAddress();
    }

    public async genShieldedAddress(): Promise<string> {
        return await this.getZpClient().generateAddress();
    }

    public async genShieldedAddressUniversal(): Promise<string> {
        return await this.getZpClient().generateUniversalAddress();
    }

    public async genShieldedAddressForSeed(seed: Uint8Array): Promise<string> {
        return await this.getZpClient().generateAddressForSeed(seed);
    }

    public async isMyAddress(shieldedAddress: string): Promise<boolean> {
        return await this.getZpClient().isMyAddress(shieldedAddress);
    }

    public async zkAddressInfo(shieldedAddress: string): Promise<any> {
        return await this.getZpClient().addressInfo(shieldedAddress);
    }

    public async getShieldedBalances(updateState: boolean = true): Promise<[bigint, bigint, bigint]> {
        const balances = this.getZpClient().getBalances(updateState);

        return balances;
    }

    public async getOptimisticTotalBalance(updateState: boolean = true): Promise<bigint> {
        const pendingBalance = this.getZpClient().getOptimisticTotalBalance(updateState);

        return pendingBalance;
    }

    // wei -> Gwei
    public async weiToShielded(amountWei: bigint): Promise<bigint> {
        return await this.getZpClient().weiToShieldedAmount(amountWei);
    }

    // Gwei -> wei
    public async shieldedToWei(amountShielded: bigint): Promise<bigint> {
        return await this.getZpClient().shieldedAmountToWei(amountShielded);
    }

    // ^tokens|wei -> wei
    public async humanToWei(amount: string): Promise<bigint> {
        if (amount.startsWith("^")) {
            const tokenAddress = this.config.pools[this.getCurrentPool()].tokenAddress;
            return BigInt(await this.getClient().toBaseTokenUnit(tokenAddress, amount.substring(1)));
        }

        return BigInt(amount);
    }

    // ^tokens|wei -> Gwei
    public async humanToShielded(amount: string): Promise<bigint> {
        return await this.weiToShielded(await this.humanToWei(amount));
    }

    // Gwei -> tokens
    public async shieldedToHuman(amountShielded: bigint): Promise<string> {
        return this.weiToHuman(await this.getZpClient().shieldedAmountToWei(amountShielded));
    }

    // wei -> tokens
    public async weiToHuman(amountWei: bigint): Promise<string> {
        const tokenAddress = this.config.pools[this.getCurrentPool()].tokenAddress;
        return await this.getClient().fromBaseTokenUnit(tokenAddress, amountWei);
    }

    public ethWeiToHuman(amountWei: bigint): string {
        return this.getClient().fromBaseUnit(amountWei);
    }

    public humanToEthWei(amount: string): bigint {
        if (amount.startsWith("^")) {
            return BigInt(this.getClient().toBaseUnit(amount.substring(1)));
        }

        return BigInt(amount);
    }

    public baseUnit(): string {
        return this.getClient().baseUnit();
    }


    public async getBalance(): Promise<[string, string]> {
        const tokenAddress = this.config.pools[this.getCurrentPool()].tokenAddress;
        const balance = await this.getClient().getBalance();
        const readable = this.ethWeiToHuman(BigInt(balance));

        return [balance.toString(10), readable];
    }

    public async getInternalState(): Promise<any> {
        return this.getZpClient().rawState();
    }

    public async getLocalTreeState(index?: bigint): Promise<TreeState> {
        return await this.getZpClient().getLocalState(index);
    }

    public async getRelayerTreeState(): Promise<TreeState> {
        return this.getZpClient().getRelayerState();
    }

    public async getRelayerOptimisticTreeState(): Promise<TreeState> {
        return this.getZpClient().getRelayerOptimisticState();
    }

    public async getLocalTreeStartIndex(): Promise<bigint | undefined> {
        return this.getZpClient().getTreeStartIndex();
    }

    public async getPoolTreeState(index?: bigint): Promise<TreeState> {
        return this.getZpClient().getPoolState(index);
    }

    public async getTreeLeftSiblings(index: bigint): Promise<TreeNode[]> {
        return await this.getZpClient().getLeftSiblings(index);
    }

    public async getStatFullSync(): Promise<SyncStat | undefined> {
        return this.getZpClient().getStatFullSync();
    }

    public async getAverageTimePerTx(): Promise<number | undefined> {
        return this.getZpClient().getAverageTimePerTx();
    }

    public async getEphemeralAddress(index: number): Promise<EphemeralAddress> {
        return this.getZpClient().getEphemeralAddress(index);
    }

    public async getNonusedEphemeralIndex(): Promise<number> {
        return this.getZpClient().getNonusedEphemeralIndex();
    }

    public async getUsedEphemeralAddresses(): Promise<EphemeralAddress[]> {
        return this.getZpClient().getUsedEphemeralAddresses();
    }

    public async getEphemeralAddressInTxCount(index: number): Promise<number> {
        return this.getZpClient().getEphemeralAddressInTxCount(index);
    }

    public async getEphemeralAddressOutTxCount(index: number): Promise<number> {
        return this.getZpClient().getEphemeralAddressOutTxCount(index);
    }

    public async getEphemeralAddressPrivateKey(index: number): Promise<string> {
        return this.getZpClient().getEphemeralAddressPrivateKey(index);
    }

    public async getAllHistory(updateState: boolean = true): Promise<HistoryRecord[]> {
        return this.getZpClient().getAllHistory(updateState);
    }

    public async generateComplianceReport(startTimestamp: number | undefined, endTimestamp: number | undefined): Promise<ComplianceHistoryRecord[]> {
        return this.getZpClient().getComplianceReport(startTimestamp, endTimestamp);
    }

    public async getPendingDirectDeposits(): Promise<DirectDeposit[]> {
        return this.getZpClient().getPendingDDs();
    }

    public async rollback(index: bigint): Promise<bigint> {
        return this.getZpClient().rollbackState(index);
    }

    public async syncState(callback?: ClientStateCallback): Promise<boolean> {
        if (callback) {
            this.getZpClient().stateCallback = callback;
        }
        const isReadyToTransact = await this.getZpClient().updateState();
        if (callback) {
            this.getZpClient().stateCallback = undefined;
        }

        return isReadyToTransact;
    }

    public async cleanInternalState(): Promise<void> {
        return this.getZpClient().cleanState();
    }

    public async getTokenBalance(): Promise<bigint> {
        return await this.getClient().getTokenBalance(this.getTokenAddr());
    }

    public async getTokenAllowance(spender: string): Promise<bigint> {
        return await this.getClient().allowance(this.getTokenAddr(), spender);
    }

    public async mint(amount: bigint): Promise<string> {
        const minterAddr = env.minters[this.getCurrentPool()];
        if (minterAddr) {
            return await this.getClient().mint(minterAddr, amount);
        } else {
            throw new Error('Cannot find the minter address. Most likely that token is not for test');
        }
    }

    public async transfer(to: string, amount: bigint): Promise<string> {
        return await this.getClient().transfer(to, amount);
    }

    public async transferToken(to: string, amount: bigint): Promise<string> {
        return await this.getClient().transferToken(this.getTokenAddr(), to, amount);
    }

    public async getTxParts(txType: TxType, amounts: bigint[], swapAmount?: bigint): Promise<Array<TransferConfig>> {
        const transfers: TransferRequest[] = amounts.map((oneAmount, index) => {
            return { destination: `dest-${index}`, amountGwei: oneAmount};
        });

        const relayerFee = await this.getZpClient().getRelayerFee();
        console.info(`Using relayer fee: base = ${txType == TxType.Transfer ? relayerFee.fee.transfer : relayerFee.fee.withdrawal}, perByte = ${relayerFee.oneByteFee}${swapAmount ? `swap = ${relayerFee.nativeConvertFee}` : ''}`);

        return await this.getZpClient().getTransactionParts(txType, transfers, relayerFee, swapAmount, false);
    }

    public async getLimits(address: string | undefined): Promise<PoolLimits> {
        let addr = address;
        if (address === undefined) {
            addr = await this.getClient().getAddress();
        }

        return await this.getZpClient().getLimits(addr, false);
    }

    public async minTxAmount(): Promise<bigint> {
        return await this.getZpClient().minTxAmount();
     }
    public async getMaxAvailableTransfer(txType: TxType, swapAmount?: bigint): Promise<bigint> {
        return await this.getZpClient().calcMaxAvailableTransfer(txType, undefined, swapAmount, false);
    }

    public async minFee(txType: TxType): Promise<bigint> {
        return await this.getZpClient().atomicTxFee(txType);
    }

    public async estimateFee(amounts: bigint[], txType: TxType, swapAmount: bigint = 0n, updateState: boolean = true): Promise<FeeAmount> {
        return await this.getZpClient().feeEstimate(amounts, txType, swapAmount, updateState);
    }

    public async maxSwapAmount() : Promise<bigint> {
        return BigInt(await this.getZpClient().maxSupportedTokenSwap());
    }

    public getTransactionUrl(txHash: string, chainId: number | undefined = undefined): string {
        const curChainId = chainId ?? env.pools[this.getCurrentPool()].chainId;
        const txUrl = env.blockExplorerUrls[String(curChainId)].tx;
        return txUrl.replace('{{hash}}', txHash);
    }

    public getAddressUrl(addr: string, chainId: number | undefined = undefined): string {
        const curChainId = chainId ?? env.pools[this.getCurrentPool()].chainId;
        const addrUrl = env.blockExplorerUrls[String(curChainId)].address;
        return addrUrl.replace('{{addr}}', addr);
    }

    public async depositShielded(amount: bigint): Promise<{jobId: string, txHash: string}> {
        let myAddress = await this.getClient().getAddress();
        
        console.log('Waiting while state become ready...');
        const ready = await this.getZpClient().waitReadyToTransact();
        if (ready) {

            const depositScheme = this.config.pools[this.getCurrentPool()].depositScheme;

            const feeEst = await this.getZpClient().feeEstimate([amount], depositScheme == DepositType.Approve ? TxType.Deposit : TxType.BridgeDeposit, 0n, false);
            const relayerFee = feeEst.relayerFee;
            console.info(`Using relayer fee: base = ${depositScheme == DepositType.Approve  ? relayerFee.fee.deposit : relayerFee.fee.permittableDeposit}, perByte = ${relayerFee.oneByteFee}`);
                        
            let totalNeededAmount = await this.getZpClient().shieldedAmountToWei(amount + feeEst.total);
            if (depositScheme == DepositType.Approve) {
                // check a token approvement if needed (in case of approve deposit scheme)
                const currentAllowance = await this.getClient().allowance(this.getTokenAddr(), this.getPoolAddr());
                if (totalNeededAmount > currentAllowance) {
                    totalNeededAmount -= currentAllowance;
                    console.log(`Increasing allowance for the Pool (${this.getPoolAddr()}) to spend our tokens (+ ${await this.weiToHuman(totalNeededAmount)} ${this.tokenSymbol()})`);
                    await this.getClient().increaseAllowance(this.getTokenAddr(), this.getPoolAddr(), totalNeededAmount);
                } else {
                    console.log(`Current allowance (${await this.weiToHuman(currentAllowance)} ${this.tokenSymbol()}) is greater or equal than needed (${await this.weiToHuman(totalNeededAmount)} ${this.tokenSymbol()}). Skipping approve`);
                }
            } else if (depositScheme == DepositType.PermitV2) {
                const currentAllowance = await this.getClient().allowance(this.getTokenAddr(), PERMIT2_CONTRACT);
                if (totalNeededAmount > currentAllowance) {
                    const maxTokensAmount = 2n ** 256n - 1n;
                    console.log(`Approving Permit2 contract (${PERMIT2_CONTRACT}) to spend max amount of our tokens`);
                    await this.getClient().approve(this.getTokenAddr(), PERMIT2_CONTRACT, maxTokensAmount);
                } else {
                    console.log(`Current allowance (${await this.weiToHuman(currentAllowance)} ${this.tokenSymbol()}) is greater or equal than needed (${await this.weiToHuman(totalNeededAmount)} ${this.tokenSymbol()}). Skipping approve`);
                }
            }

            console.log('Making deposit...');
            let jobId;
            jobId = await this.getZpClient().deposit(amount, async (signingRequest) => {
                switch (signingRequest.type) {
                    case SignatureType.TypedDataV4:
                        return this.getClient().signTypedData(signingRequest.data);
                    case SignatureType.PersonalSign:
                        return this.getClient().sign(signingRequest.data);
                    default:
                        throw new Error(`Signing request with unknown type`);
                }
            }, myAddress, relayerFee);

            console.log('Please wait relayer provide txHash for job %s...', jobId);

            return {jobId, txHash: (await this.getZpClient().waitJobTxHash(jobId))};
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    public async depositShieldedEphemeral(amount: bigint, index: number): Promise<{jobId: string, txHash: string}> {
        console.log('Waiting while state become ready...');
        const ready = await this.getZpClient().waitReadyToTransact();
        if (ready) {
            const relayerFee = await this.getZpClient().getRelayerFee();
            const depositScheme = this.config.pools[this.getCurrentPool()].depositScheme;
            console.info(`Using relayer fee: base = ${depositScheme == DepositType.Approve  ? relayerFee.fee.deposit : relayerFee.fee.permittableDeposit}, perByte = ${relayerFee.oneByteFee}`);

            console.log('Making deposit...');
            let jobId;
            jobId = await this.getZpClient().depositEphemeral(amount, index, relayerFee);

            console.log('Please wait relayer complete the job %s...', jobId);

            return {jobId, txHash: (await this.getZpClient().waitJobTxHash(jobId))};
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    // returns txHash in promise
    public async directDeposit(amount: bigint, ddType: DirectDepositType = DirectDepositType.Token): Promise<string> {
        const ddFee = (await this.getZpClient().directDepositFee());
        const amountWithFeeWei = await this.getZpClient().shieldedAmountToWei(amount + ddFee);

        const ddContract = await this.getClient().getDirectDepositContract(this.getPoolAddr());

        if (ddType == DirectDepositType.Token) {
            let totalApproveAmount = amountWithFeeWei;
            const currentAllowance = await this.getClient().allowance(this.getTokenAddr(), ddContract);
            if (totalApproveAmount > currentAllowance) {
                console.log(`Approving allowance for ${ddContract} to spend max amount of our tokens`);
                const maxTokensAmount = 2n ** 256n - 1n;
                const txHash = await this.getClient().approve(this.getTokenAddr(), ddContract, maxTokensAmount);
                console.log(`Approve txHash: ${txHash}`);
            } else {
                console.log(`Current allowance (${await this.weiToHuman(currentAllowance)} ${this.tokenSymbol()}) is greater or equal than needed (${await this.weiToHuman(totalApproveAmount)} ${this.tokenSymbol()}). Skipping approve`);
            }
        }

        console.log('Making direct deposit...');

        let txHash = '';
        await this.getZpClient().directDeposit(
            ddType,
            await this.getRegularAddress(),
            amount,
            async (tx: PreparedTransaction) => {
                txHash = await this.getClient().sendTransaction(tx.to, tx.amount, tx.data, tx.selector);
                return txHash;
            }
        );

        return txHash;
    }

    // returns txHash in promise
    public async approveAllowance(spender: string, amount: bigint): Promise<string> {
        console.log(`Approving allowance for ${spender} to spend our tokens (${await this.weiToHuman(amount)} ${this.tokenSymbol()})`);
        return await this.getClient().approve(this.getTokenAddr(), spender, amount);
    }

    public async transferShielded(transfers: TransferRequest[]): Promise<{jobId: string, txHash: string}[]> {
        console.log('Waiting while state become ready...');
        const ready = await this.getZpClient().waitReadyToTransact();
        if (ready) {
            const relayerFee = await this.getZpClient().getRelayerFee();
            console.info(`Using relayer fee: base = ${relayerFee.fee.transfer}, perByte = ${relayerFee.oneByteFee}`);
            
            console.log('Making transfer...');
            const jobIds: string[] = await this.getZpClient().transferMulti(transfers, relayerFee);
            console.log('Please wait relayer provide txHash%s %s...', jobIds.length > 1 ? 'es for jobs' : ' for job', jobIds.join(', '));

            return await this.getZpClient().waitJobsTxHashes(jobIds);
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    public async withdrawShielded(amount: bigint, external_addr: string, nativeAmount: bigint = 0n): Promise<{jobId: string, txHash: string}[]> {
        let address = external_addr ?? await this.getClient().getAddress();

        console.log('Waiting while state become ready...');
        const ready = await this.getZpClient().waitReadyToTransact();
        if (ready) {
            const relayerFee = await this.getZpClient().getRelayerFee();
            console.info(`Using relayer fee: base = ${relayerFee.fee.withdrawal}, perByte = ${relayerFee.oneByteFee}${nativeAmount ? `swap = ${relayerFee.nativeConvertFee}` : ''}`);

            console.log('Making withdraw...');
            const jobIds: string[] = await this.getZpClient().withdrawMulti(address, amount, nativeAmount, relayerFee);
            console.log('Please wait relayer provide txHash%s %s...', jobIds.length > 1 ? 'es for jobs' : ' for job', jobIds.join(', '));

            return await this.getZpClient().waitJobsTxHashes(jobIds);
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    public async giftCardBalance(giftCard: GiftCardProperties): Promise<bigint> {
        return await this.getZpClient().giftCardBalance(giftCard);
    }

    public async redeemGiftCard(giftCard: GiftCardProperties): Promise<{jobId: string, txHash: string}> {
        const proverMode = this.config.pools[this.getCurrentPool()].delegatedProverUrls.length > 0 ? 
            ProverMode.DelegatedWithFallback : 
            ProverMode.Local;

        console.log('Redeeming gift-card...');
        const jobId: string = await this.getZpClient().redeemGiftCard(giftCard, proverMode);
        console.log(`Please wait relayer provide txHash for job ${jobId}...`);

        return {jobId, txHash: (await this.getZpClient().waitJobTxHash(jobId))};
    }

    public async codeForGiftCard(giftCard: GiftCardProperties): Promise<string> {
        return this.getZpClient().codeForGiftCard(giftCard);
    }

    public async giftCardFromCode(code: string): Promise<GiftCardProperties> {
        return this.getZpClient().giftCardFromCode(code);
    }

    public async verifyShieldedAddress(shieldedAddress: string): Promise<boolean> {
        return await this.getZpClient().verifyShieldedAddress(shieldedAddress);
    }

    public async setProverMode(mode: ProverMode) {
        await this.getZpClient().setProverMode(mode);
    }

    public async getProverMode(): Promise<ProverMode> {
        return this.getZpClient().getProverMode();
    }
    
    public async libraryVersion(): Promise<string> {
        return this.getZpClient().getLibraryVersion();
    }

    public async relayerVersion(): Promise<ServiceVersion> {
        return await this.getZpClient().getRelayerVersion();
    }

    public async proverVersion(): Promise<ServiceVersion> {
        return await this.getZpClient().getProverVersion();
    }
}