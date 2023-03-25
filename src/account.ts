import AES from 'crypto-js/aes';
import Utf8 from 'crypto-js/enc-utf8';
import { EthereumClient, PolkadotClient, Client as NetworkClient } from 'zeropool-support-js';
import { ZkBobClient, HistoryRecord,
         TransferConfig, FeeAmount, TxType,
         PoolLimits, InitLibCallback,
         TreeState, EphemeralAddress, SyncStat, TreeNode,
         ServiceVersion,
        } from 'zkbob-client-js';
import bip39 from 'bip39-light';
import HDWalletProvider from '@truffle/hdwallet-provider';
import { deriveSpendingKeyZkBob } from 'zkbob-client-js/lib/utils';
import Web3 from 'web3'
import { TransferRequest } from 'zkbob-client-js/lib/client';
import { AcccountConfig, ClientConfig, ProverMode } from 'zkbob-client-js/lib/config';
import { v4 as uuidv4 } from 'uuid';



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

function loadDevEnvironment() {
    if (process.env.NODE_ENV === 'development') {
        console.log('Dev environment, using local env variables.');
        NETWORK = process.env.NETWORK;
        CHAIN_ID = process.env.CHAIN_ID;
        POOL_NAME = process.env.POOL_NAME;
        CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
        TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
        MINTER_ADDRESS = process.env.MINTER_ADDRESS;
        RELAYER_URL = process.env.RELAYER_URL;
        RPC_URL = process.env.RPC_URL;
        TRANSACTION_URL = process.env.TRANSACTION_URL;
        TOKEN_SYMBOL = process.env.TOKEN_SYMBOL;
        SHIELDED_TOKEN_SYMBOL = process.env.SHIELDED_TOKEN_SYMBOL;
        DELEGATED_PROVER_URL = process.env.DELEGATED_PROVER_URL;
        CLOUD_API_ENDPOINT = process.env.CLOUD_API_ENDPOINT;
        GIFTCARD_REDEMPTION_URL = process.env.GIFTCARD_REDEMPTION_URL;
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

export default class Account {
    readonly accountName: string;
    private storage: AccountStorage;
    public client: NetworkClient;
    private zpClient?: ZkBobClient;
    private zpClientPromise?: Promise<ZkBobClient>;
    private initError?: Error;

    public initCallback?: InitAccountCallback;
    
    public supportId: string;

    constructor(accountName: string, callback?: InitAccountCallback) {
        loadDevEnvironment();

        this.initCallback = callback;
        this.accountName = accountName;
        this.storage = new LocalAccountStorage();

        const snarkParamsConfig = {
            transferParamsUrl: './assets/transfer_params.bin',
            treeParamsUrl: './assets/tree_params.bin',
            transferVkUrl: './assets/transfer_verification_key.json',
            treeVkUrl: './assets/tree_verification_key.json',
        };

        this.supportId = uuidv4();

        const bulkConfigUrl = `./assets/zkbob-${NETWORK}-coldstorage.cfg`

        const clientConf: ClientConfig = {
            pools: {
                [POOL_NAME]: {
                    chainId: Number(CHAIN_ID),
                    poolAddress: CONTRACT_ADDRESS,
                    tokenAddress: TOKEN_ADDRESS,
                    relayerUrls: [RELAYER_URL],
                    delegatedProverUrls: [DELEGATED_PROVER_URL],
                    coldStorageConfigPath: bulkConfigUrl,
                }
            },
            chains: {
                [CHAIN_ID]: {
                    rpcUrls: [RPC_URL],
                }
            },
            snarkParams: snarkParamsConfig,
            supportId: this.supportId,
            forcedMultithreading: undefined,
        };

        if (this.initCallback) this.initCallback({ state: InitAccountState.ClientInitializing });

        this.zpClientPromise = ZkBobClient.create(clientConf, POOL_NAME);

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

    public async init(
        mnemonic: string,
        password: string,
        isNewAcc: boolean,
        loadingCallback: InitLibCallback | undefined = undefined
    ): Promise<void> {

        // waiting when accountless client will initialized (or failed)
        await this.zpClientPromise;

        if (this.initCallback) this.initCallback({ state: InitAccountState.AccountInitializing });

        if (!this.zpClient) {
            if (this.initCallback) this.initCallback({ state: InitAccountState.Failed, error: this.initError });
            return;
        }

        // Initialize L1 network client (to interact with the native blockchain)
        const provider = new HDWalletProvider({
            mnemonic,
            providerOrUrl: RPC_URL,
        });
        const client = new EthereumClient(provider, { transactionUrl: TRANSACTION_URL });
        client.gasMultiplier = 1.2; // increase default gas
        this.client = client;

        const sk = deriveSpendingKeyZkBob(mnemonic);

        const accountConf: AcccountConfig = {
            sk,
            pool: POOL_NAME,
            birthindex: isNewAcc ? -1 : undefined,
            proverMode: ProverMode.Local,
        }
        
        try {
            await this.zpClient?.login(accountConf);
        } catch (err) {
            this.initError = err;
            if (this.initCallback) this.initCallback({ state: InitAccountState.Failed, error: err });
            return;
        }

        this.initError = undefined;
        if (this.initCallback) this.initCallback({ state: InitAccountState.FullClientReady });

        this.storage.set(this.accountName, 'seed', await AES.encrypt(mnemonic, password).toString());
    }

    public async unlockAccount(
        password: string,
        loadingCallback: InitLibCallback | undefined = undefined
    ) {
        let seed = this.decryptSeed(password);
        await this.init(seed, password, false, loadingCallback);
    }

    public async getCurrentPool(): Promise<string> {
        this.assertZpClient();
        return this.zpClient.currentPool();
    }

    public async getPools(): Promise<string[]> {
        this.assertZpClient();
        return this.zpClient.availabePools();
    }

    public async switchPool(poolAlias: string): Promise<void> {
        this.assertZpClient();
        return this.zpClient.switchToPool(poolAlias);
    }

    public getSeed(password: string): string {
        return this.decryptSeed(password);
    }

    public isInitialized(): boolean {
        return !!this.client;
    }

    public isAccountPresent(): boolean {
        return !!this.storage.get(this.accountName, 'seed');
    }

    private assertZpClient() {
        if (!this.zpClient) {
            const errMsg = this.initError ? `(client init failed: ${this.initError.message})` : '(unknown error)';
            throw new Error(`ZkAccount is not ready currently ${errMsg}`);
        }
    }

    public nativeSymbol(): string {
        switch(NETWORK) {
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
            default: return '';
        }
    }

    public async getRegularAddress(): Promise<string> {
        return await this.client.getAddress();
    }

    public async genShieldedAddress(): Promise<string> {
        this.assertZpClient();
        return await this.zpClient.generateAddress();
    }

    public async isMyAddress(shieldedAddress: string): Promise<boolean> {
        this.assertZpClient();
        return await this.zpClient.isMyAddress(shieldedAddress);
    }

    public async getShieldedBalances(updateState: boolean = true): Promise<[bigint, bigint, bigint]> {
        this.assertZpClient();
        const balances = this.zpClient.getBalances(updateState);

        return balances;
    }

    public async getOptimisticTotalBalance(updateState: boolean = true): Promise<bigint> {
        this.assertZpClient();
        const pendingBalance = this.zpClient.getOptimisticTotalBalance(updateState);

        return pendingBalance;
    }

    // wei -> Gwei
    public async weiToShielded(amountWei: bigint): Promise<bigint> {
        this.assertZpClient();
        return await this.zpClient.weiToShieldedAmount(amountWei);
    }

    // Gwei -> wei
    public async shieldedToWei(amountShielded: bigint): Promise<bigint> {
        this.assertZpClient();
        return await this.zpClient.shieldedAmountToWei(amountShielded);
    }

    // ^tokens|wei -> wei
    public async humanToWei(amount: string): Promise<bigint> {
        if (amount.startsWith("^")) {
            return BigInt(this.client.toBaseUnit(amount.substr(1)));
        }

        return BigInt(amount);
    }

    // ^tokens|wei -> Gwei
    public async humanToShielded(amount: string): Promise<bigint> {
        return await this.weiToShielded(await this.humanToWei(amount));
    }

    // Gwei -> tokens
    public async shieldedToHuman(amountShielded: bigint): Promise<string> {
        this.assertZpClient();
        return this.weiToHuman(await this.zpClient.shieldedAmountToWei(amountShielded));

    }

    // wei -> tokens
    public async weiToHuman(amountWei: bigint): Promise<string> {
        return this.client.fromBaseUnit(amountWei.toString());
    }


    public async getBalance(): Promise<[string, string]> {
        const balance = await this.client.getBalance();
        const readable = this.client.fromBaseUnit(balance);

        return [balance, readable];
    }

    public async getInternalState(): Promise<any> {
        this.assertZpClient();
        return this.zpClient.rawState();
    }

    public async getLocalTreeState(index?: bigint): Promise<TreeState> {
        this.assertZpClient();
        return await this.zpClient.getLocalState(index);
    }

    public async getRelayerTreeState(): Promise<TreeState> {
        this.assertZpClient();
        return this.zpClient.getRelayerState();
    }

    public async getRelayerOptimisticTreeState(): Promise<TreeState> {
        this.assertZpClient();
        return this.zpClient.getRelayerOptimisticState();
    }

    public async getLocalTreeStartIndex(): Promise<bigint | undefined> {
        this.assertZpClient();
        return this.zpClient.getTreeStartIndex();
    }

    public async getPoolTreeState(index?: bigint): Promise<TreeState> {
        this.assertZpClient();
        return this.zpClient.getPoolState(index);
    }

    public async getTreeLeftSiblings(index: bigint): Promise<TreeNode[]> {
        this.assertZpClient();
        return await this.zpClient.getLeftSiblings(index);
    }

    public async getStatFullSync(): Promise<SyncStat | undefined> {
        this.assertZpClient();
        return this.zpClient.getStatFullSync();
    }

    public async getAverageTimePerTx(): Promise<number | undefined> {
        this.assertZpClient();
        return this.zpClient.getAverageTimePerTx();
    }

    public async getEphemeralAddress(index: number): Promise<EphemeralAddress> {
        this.assertZpClient();
        return this.zpClient.getEphemeralAddress(index);
    }

    public async getNonusedEphemeralIndex(): Promise<number> {
        this.assertZpClient();
        return this.zpClient.getNonusedEphemeralIndex();
    }

    public async getUsedEphemeralAddresses(): Promise<EphemeralAddress[]> {
        this.assertZpClient();
        return this.zpClient.getUsedEphemeralAddresses();
    }

    public async getEphemeralAddressInTxCount(index: number): Promise<number> {
        this.assertZpClient();
        return this.zpClient.getEphemeralAddressInTxCount(index);
    }

    public async getEphemeralAddressOutTxCount(index: number): Promise<number> {
        this.assertZpClient();
        return this.zpClient.getEphemeralAddressOutTxCount(index);
    }

    public async getEphemeralAddressPrivateKey(index: number): Promise<string> {
        this.assertZpClient();
        return this.zpClient.getEphemeralAddressPrivateKey(index);
    }

    public async getAllHistory(updateState: boolean = true): Promise<HistoryRecord[]> {
        this.assertZpClient();
        return this.zpClient.getAllHistory(updateState);
    }

    public async rollback(index: bigint): Promise<bigint> {
        this.assertZpClient();
        return this.zpClient.rollbackState(index);
    }

    public async syncState(): Promise<boolean> {
        this.assertZpClient();
        return this.zpClient.updateState();
    }

    public async cleanInternalState(): Promise<void> {
        this.assertZpClient();
        return this.zpClient.cleanState();
    }

    // TODO: Support multiple tokens
    public async getTokenBalance(): Promise<string> {
        return await this.client.getTokenBalance(TOKEN_ADDRESS);
    }

    public async mint(amount: bigint): Promise<string> {
        if (MINTER_ADDRESS) {
            return await this.client.mint(MINTER_ADDRESS, amount.toString());
        } else {
            throw new Error('Cannot find the minter address. Most likely that token is not for test');
        }
    }

    public async transfer(to: string, amount: bigint): Promise<string> {
        return await this.client.transfer(to, amount.toString());
    }

    public async transferToken(to: string, amount: bigint): Promise<string> {
        return await this.client.transferToken(TOKEN_ADDRESS, to, amount.toString());
    }

    public async getTxParts(amounts: bigint[], fee: bigint): Promise<Array<TransferConfig>> {
        this.assertZpClient();
        const transfers: TransferRequest[] = amounts.map((oneAmount, index) => {
            return { destination: `dest-${index}`, amountGwei: oneAmount};
        });
        return await this.zpClient.getTransactionParts(transfers, fee, false);
    }

    public async getLimits(address: string | undefined): Promise<PoolLimits> {
        this.assertZpClient();
        let addr = address;
        if (address === undefined) {
            addr = await this.client.getAddress();
        }

        return await this.zpClient.getLimits(addr, false);
    }

    public async minTxAmount(): Promise<bigint> {
        this.assertZpClient();
        return await this.zpClient.minTxAmount();
     }
    public async getMaxAvailableTransfer(amount: bigint, fee: bigint): Promise<bigint> {
        this.assertZpClient();
        return await this.zpClient.calcMaxAvailableTransfer(false);
    }

    public async minFee(amount: bigint, txType: TxType): Promise<bigint> {
        this.assertZpClient();
        return await this.zpClient.atomicTxFee();
    }

    public async estimateFee(amounts: bigint[], txType: TxType, updateState: boolean = true): Promise<FeeAmount> {
        this.assertZpClient();
        return await this.zpClient.feeEstimate(amounts, txType, updateState);
    }

    public getTransactionUrl(txHash: string): string {
        return this.client.getTransactionUrl(txHash);
    }

    public async depositShielded(amount: bigint): Promise<{jobId: string, txHash: string}> {
        this.assertZpClient();
        let fromAddress = null;

        console.log('Waiting while state become ready...');
        const ready = await this.zpClient.waitReadyToTransact();
        if (ready) {
            const txFee = (await this.zpClient.feeEstimate([amount], TxType.Deposit, false));

            let totalApproveAmount = await this.zpClient.shieldedAmountToWei(amount + txFee.totalPerTx);
            const currentAllowance = await this.client.allowance(TOKEN_ADDRESS, CONTRACT_ADDRESS);
            if (totalApproveAmount > currentAllowance) {
                totalApproveAmount -= currentAllowance;
                console.log(`Increasing allowance for the Pool (${CONTRACT_ADDRESS}) to spend our tokens (+ ${this.weiToHuman(totalApproveAmount)} ${TOKEN_SYMBOL})`);
                await this.client.increaseAllowance(TOKEN_ADDRESS, CONTRACT_ADDRESS, totalApproveAmount.toString());
            } else {
                console.log(`Current allowance (${this.weiToHuman(currentAllowance)} ${TOKEN_SYMBOL}) is greater or equal than needed (${this.weiToHuman(totalApproveAmount)} ${TOKEN_SYMBOL}). Skipping approve`);
            }

            console.log('Making deposit...');
            const jobId = await this.zpClient.deposit(amount, (data) => this.client.sign(data), fromAddress, txFee.totalPerTx);
            console.log('Please wait relayer provide txHash for job %s...', jobId);

            return {jobId, txHash: (await this.zpClient.waitJobTxHash(jobId)) };
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }
    

    private async createPermittableDepositData(tokenAddress: string, version: string, owner: string, spender: string, value: bigint, deadline: bigint, salt: string) {
        const tokenName = await this.client.getTokenName(tokenAddress);
        const chainId = await this.client.getChainId();
        const nonce = await this.client.getTokenNonce(tokenAddress);

        const domain = {
            name: tokenName,
            version: version,
            chainId: chainId,
            verifyingContract: tokenAddress,
        };

        const types = {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          Permit: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
              { name: "value", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
              { name: "salt", type: "bytes32" }
            ],
        };

        const message = { owner, spender, value: value.toString(), nonce, deadline: deadline.toString(), salt };

        const data = { types, primaryType: "Permit", domain, message };

        return data;
    }

    public async depositShieldedPermittable(amount: bigint): Promise<{jobId: string, txHash: string}> {
        this.assertZpClient();
        let myAddress = null;
        myAddress = await this.client.getAddress();
        
        console.log('Waiting while state become ready...');
        const ready = await this.zpClient.waitReadyToTransact();
        if (ready) {
            const txFee = (await this.zpClient.feeEstimate([amount], TxType.BridgeDeposit, false));

            console.log('Making deposit...');
            let jobId;
            jobId = await this.zpClient.depositPermittable(amount, async (deadline, value, salt) => {
                const dataToSign = await this.createPermittableDepositData(TOKEN_ADDRESS, '1', myAddress, CONTRACT_ADDRESS, value, deadline, salt);
                return this.client.signTypedData(dataToSign)
            }, myAddress, txFee.totalPerTx);

            console.log('Please wait relayer provide txHash for job %s...', jobId);

            return {jobId, txHash: (await this.zpClient.waitJobTxHash(jobId))};
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    public async depositShieldedPermittableEphemeral(amount: bigint, index: number): Promise<{jobId: string, txHash: string}> {
        this.assertZpClient();
        let myAddress = null;
        myAddress = await this.client.getAddress();
        
        console.log('Waiting while state become ready...');
        const ready = await this.zpClient.waitReadyToTransact();
        if (ready) {
            const txFee = (await this.zpClient.feeEstimate([amount], TxType.BridgeDeposit, false));

            console.log('Making deposit...');
            let jobId;
            jobId = await this.zpClient.depositPermittableEphemeral(amount, index, txFee.totalPerTx);

            console.log('Please wait relayer complete the job %s...', jobId);

            return {jobId, txHash: (await this.zpClient.waitJobTxHash(jobId))};
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    // returns txHash in promise
    public async directDeposit(to: string, amount: bigint): Promise<string> {
        this.assertZpClient();
        const ddFee = (await this.zpClient.directDepositFee());
        const amountWithFeeWei = await this.zpClient.shieldedAmountToWei(amount + ddFee);

        const ddContract = await this.client.getDirectDepositContract(CONTRACT_ADDRESS);

        let totalApproveAmount = amountWithFeeWei;
        const currentAllowance = await this.client.allowance(TOKEN_ADDRESS, ddContract);
        if (totalApproveAmount > currentAllowance) {
            totalApproveAmount -= currentAllowance;
            console.log(`Increasing allowance for the direct deposit contact (${ddContract}) to spend our tokens (+ ${this.weiToHuman(totalApproveAmount)} ${TOKEN_SYMBOL})`);
            await this.client.increaseAllowance(TOKEN_ADDRESS, ddContract, totalApproveAmount.toString());
        } else {
            console.log(`Current allowance (${this.weiToHuman(currentAllowance)} ${TOKEN_SYMBOL}) is greater or equal than needed (${this.weiToHuman(totalApproveAmount)} ${TOKEN_SYMBOL}). Skipping approve`);
        }

        console.log('Making direct deposit...');
        return await this.client.directDeposit(CONTRACT_ADDRESS, amountWithFeeWei.toString(), to);
    }

    // returns txHash in promise
    public async approveAllowance(spender: string, amount: bigint): Promise<string> {
        console.log(`Approving allowance for ${spender} to spend our tokens (${this.weiToHuman(amount)} ${TOKEN_SYMBOL})`);
        return await this.client.approve(TOKEN_ADDRESS, spender, amount.toString());
    }

    public async transferShielded(transfers: TransferRequest[]): Promise<{jobId: string, txHash: string}[]> {
        this.assertZpClient();
        console.log('Waiting while state become ready...');
        const ready = await this.zpClient.waitReadyToTransact();
        if (ready) {
            const amounts = transfers.map((oneTransfer) => oneTransfer.amountGwei);
            const txFee = (await this.zpClient.feeEstimate(amounts, TxType.Transfer, false));
            
            console.log('Making transfer...');
            const jobIds: string[] = await this.zpClient.transferMulti(transfers, txFee.totalPerTx);
            console.log('Please wait relayer provide txHash%s %s...', jobIds.length > 1 ? 'es for jobs' : ' for job', jobIds.join(', '));

            return await this.zpClient.waitJobsTxHashes(jobIds);
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    public async withdrawShielded(amount: bigint, external_addr: string): Promise<{jobId: string, txHash: string}[]> {
        this.assertZpClient();
        let address = external_addr ?? await this.client.getAddress();

        console.log('Waiting while state become ready...');
        const ready = await this.zpClient.waitReadyToTransact();
        if (ready) {
            const txFee = (await this.zpClient.feeEstimate([amount], TxType.Transfer, false));

            console.log('Making withdraw...');
            const jobIds: string[] = await this.zpClient.withdrawMulti(address, amount, txFee.totalPerTx);
            console.log('Please wait relayer provide txHash%s %s...', jobIds.length > 1 ? 'es for jobs' : ' for job', jobIds.join(', '));

            return await this.zpClient.waitJobsTxHashes(jobIds);
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    public async verifyShieldedAddress(shieldedAddress: string): Promise<boolean> {
        this.assertZpClient();
        return await this.zpClient.verifyShieldedAddress(shieldedAddress);
    }

    public async setProverMode(mode: ProverMode) {
        this.assertZpClient();
        await this.zpClient.setProverMode(mode);
    }

    public async getProverMode(): Promise<ProverMode> {
        this.assertZpClient();
        return this.zpClient.getProverMode();
    }
    
    public async relayerVersion(): Promise<ServiceVersion> {
        this.assertZpClient();
        return await this.zpClient.getRelayerVersion();
    }

    public async proverVersion(): Promise<ServiceVersion> {
        this.assertZpClient();
        return await this.zpClient.getProverVersion();
    }

    private decryptSeed(password: string): string {
        const cipherText = this.storage.get(this.accountName, 'seed');
        let seed;
        try {
            seed = AES.decrypt(cipherText, password).toString(Utf8);
            if (!bip39.validateMnemonic(seed)) throw new Error('invalid mnemonic');
        } catch (_) {
            throw new Error('Incorrect password');
        }

        return seed;
    }
}