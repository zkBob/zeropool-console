import AES from 'crypto-js/aes';
import Utf8 from 'crypto-js/enc-utf8';
import { EthereumClient, PolkadotClient, Client as NetworkClient } from 'zeropool-support-js';
import { init, ZkBobClient, HistoryRecord, TransferConfig, FeeAmount, TxType,
          PoolLimits, InitLibCallback, TreeState, EphemeralAddress, SyncStat } from 'zkbob-client-js';
import bip39 from 'bip39-light';
import HDWalletProvider from '@truffle/hdwallet-provider';
import { deriveSpendingKeyZkBob } from 'zkbob-client-js/lib/utils';
import { NetworkType } from 'zkbob-client-js/lib/network-type';
import { EvmNetwork } from 'zkbob-client-js/lib/networks/evm';
import { PolkadotNetwork } from 'zkbob-client-js/lib/networks/polkadot';

import { TransferRequest } from 'zkbob-client-js/lib/client';


function isEvmBased(network: string): boolean {
    return ['ethereum', 'aurora', 'xdai', 'polygon', 'sepolia', 'goerli'].includes(network);
}

function isSubstrateBased(network: string): boolean {
    return ['polkadot', 'kusama'].includes(network);
}

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

// TODO: Extract timeout management code
export default class Account {
    readonly accountName: string;
    private storage: AccountStorage;
    public client: NetworkClient;
    private zpClient: ZkBobClient;

    constructor(accountName: string) {
        this.accountName = accountName;
        this.storage = new LocalAccountStorage();

        if (process.env.NODE_ENV === 'development') {
            console.log('Dev environment, using local env variables.');
            NETWORK = process.env.NETWORK;
            CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
            TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
            MINTER_ADDRESS = process.env.MINTER_ADDRESS;
            RELAYER_URL = process.env.RELAYER_URL;
            RPC_URL = process.env.RPC_URL;
            TRANSACTION_URL = process.env.TRANSACTION_URL;
            TOKEN_SYMBOL = process.env.TOKEN_SYMBOL;
            SHIELDED_TOKEN_SYMBOL = process.env.SHIELDED_TOKEN_SYMBOL;
        }
    }

    public async init(
        mnemonic: string,
        password: string,
        loadingCallback: InitLibCallback | undefined = undefined
    ): Promise<void> {
        const snarkParamsConfig = {
            transferParamsUrl: './assets/transfer_params.bin',
            treeParamsUrl: './assets/tree_params.bin',
            transferVkUrl: './assets/transfer_verification_key.json',
            treeVkUrl: './assets/tree_verification_key.json',
        };

        const { worker } = await init(snarkParamsConfig, RELAYER_URL, loadingCallback);

        let client, network;
        if (isEvmBased(NETWORK)) {
            const provider = new HDWalletProvider({
                mnemonic,
                providerOrUrl: RPC_URL,
            });
            client = new EthereumClient(provider, { transactionUrl: TRANSACTION_URL });
            network = new EvmNetwork(RPC_URL);
        } else if (isSubstrateBased(NETWORK)) {
            client = await PolkadotClient.create(mnemonic, { rpcUrl: RPC_URL, transactionUrl: TRANSACTION_URL });
            network = new PolkadotNetwork();
        } else {
            throw new Error(`Unknown network ${NETWORK}`);
        }

        const networkType = NETWORK as NetworkType;
        if (networkType === undefined) {
            throw new Error(`Network ${NETWORK} is unsupported by client library`);
        }

        const sk = deriveSpendingKeyZkBob(mnemonic, networkType);
        this.client = client;

        const bulkConfigUrl = `./assets/zkbob-${NETWORK}-coldstorage.cfg`
        this.zpClient = await ZkBobClient.create({
            sk,
            worker,
            tokens: {
                [TOKEN_ADDRESS]: {
                    poolAddress: CONTRACT_ADDRESS,
                    relayerUrl: RELAYER_URL,
                    coldStorageConfigPath: bulkConfigUrl,
                }
            },
            networkName: NETWORK,
            network,
        });

        this.storage.set(this.accountName, 'seed', await AES.encrypt(mnemonic, password).toString());
    }

    public async unlockAccount(
        password: string,
        loadingCallback: InitLibCallback | undefined = undefined
    ) {
        let seed = this.decryptSeed(password);
        await this.init(seed, password, loadingCallback);
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
        return await this.zpClient.generateAddress(TOKEN_ADDRESS);
    }

    public async isMyAddress(shieldedAddress: string): Promise<boolean> {
        return await this.zpClient.isMyAddress(TOKEN_ADDRESS, shieldedAddress);
    }

    public async getShieldedBalances(updateState: boolean = true): Promise<[bigint, bigint, bigint]> {
        const balances = this.zpClient.getBalances(TOKEN_ADDRESS, updateState);

        return balances;
    }

    public async getOptimisticTotalBalance(updateState: boolean = true): Promise<bigint> {
        const pendingBalance = this.zpClient.getOptimisticTotalBalance(TOKEN_ADDRESS, updateState);

        return pendingBalance;
    }

    // wei -> Gwei
    public weiToShielded(amountWei: bigint): bigint {
        return this.zpClient.weiToShieldedAmount(TOKEN_ADDRESS, amountWei);
    }

    // Gwei -> wei
    public shieldedToWei(amountShielded: bigint): bigint {
        return this.zpClient.shieldedAmountToWei(TOKEN_ADDRESS, amountShielded);
    }

    // ^tokens|wei -> wei
    public humanToWei(amount: string): bigint {
        if (amount.startsWith("^")) {
            return BigInt(this.client.toBaseUnit(amount.substr(1)));
        }

        return BigInt(amount);
    }

    // ^tokens|wei -> Gwei
    public humanToShielded(amount: string): bigint {
        return this.weiToShielded(this.humanToWei(amount));
    }

    // Gwei -> tokens
    public shieldedToHuman(amountShielded: bigint): string {
        return this.weiToHuman(this.zpClient.shieldedAmountToWei(TOKEN_ADDRESS, amountShielded));

    }

    // wei -> tokens
    public weiToHuman(amountWei: bigint): string {
        return this.client.fromBaseUnit(amountWei.toString());
    }


    public async getBalance(): Promise<[string, string]> {
        const balance = await this.client.getBalance();
        const readable = this.client.fromBaseUnit(balance);

        return [balance, readable];
    }

    public async getInternalState(): Promise<any> {
        return this.zpClient.rawState(TOKEN_ADDRESS);
    }

    public async getLocalTreeState(): Promise<TreeState> {
        return await this.zpClient.getLocalState(TOKEN_ADDRESS);
    }

    public async getRelayerTreeState(): Promise<TreeState> {
        return this.zpClient.getRelayerState(TOKEN_ADDRESS);
    }

    public async getRelayerOptimisticTreeState(): Promise<TreeState> {
        return this.zpClient.getRelayerOptimisticState(TOKEN_ADDRESS);
    }

    public async getPoolTreeState(): Promise<TreeState> {
        return this.zpClient.getPoolState(TOKEN_ADDRESS);
    }

    public async getStatFullSync(): Promise<SyncStat | undefined> {
        return this.zpClient.getStatFullSync();
    }

    public async getAverageTimePerTx(): Promise<number | undefined> {
        return this.zpClient.getAverageTimePerTx();
    }

    public async getEphemeralAddress(index: number): Promise<EphemeralAddress> {
        return this.zpClient.getEphemeralAddress(TOKEN_ADDRESS, index);
    }

    public async getNonusedEphemeralIndex(): Promise<number> {
        return this.zpClient.getNonusedEphemeralIndex(TOKEN_ADDRESS);
    }

    public async getUsedEphemeralAddresses(): Promise<EphemeralAddress[]> {
        return this.zpClient.getUsedEphemeralAddresses(TOKEN_ADDRESS);
    }

    public async getEphemeralAddressInTxCount(index: number): Promise<number> {
        return this.zpClient.getEphemeralAddressInTxCount(TOKEN_ADDRESS, index);
    }

    public async getEphemeralAddressOutTxCount(index: number): Promise<number> {
        return this.zpClient.getEphemeralAddressOutTxCount(TOKEN_ADDRESS, index);
    }

    public async getEphemeralAddressPrivateKey(index: number): Promise<string> {
        return this.zpClient.getEphemeralAddressPrivateKey(TOKEN_ADDRESS, index);
    }

    public async getAllHistory(updateState: boolean = true): Promise<HistoryRecord[]> {
        return this.zpClient.getAllHistory(TOKEN_ADDRESS, updateState);
    }

    public async cleanInternalState(): Promise<void> {
        return this.zpClient.cleanState(TOKEN_ADDRESS);
    }

    // TODO: Support multiple tokens
    public async getTokenBalance(): Promise<string> {
        return await this.client.getTokenBalance(TOKEN_ADDRESS);
    }

    public async mint(amount: bigint): Promise<string> {
        return await this.client.mint(MINTER_ADDRESS, amount.toString());
    }

    public async transfer(to: string, amount: bigint): Promise<string> {
        return await this.client.transfer(to, amount.toString());
    }

    public async transferToken(to: string, amount: bigint): Promise<string> {
        return await this.client.transferToken(TOKEN_ADDRESS, to, amount.toString());
    }

    public async getTxParts(amounts: bigint[], fee: bigint): Promise<Array<TransferConfig>> {
        const transfers: TransferRequest[] = amounts.map((oneAmount, index) => {
            return { destination: `dest-${index}`, amountGwei: oneAmount};
        });
        return await this.zpClient.getTransactionParts(TOKEN_ADDRESS, transfers, fee, false);
    }

    public async getLimits(address: string | undefined): Promise<PoolLimits> {
        let addr = address;
        if (address === undefined) {
            addr = await this.client.getAddress();
        }

        return await this.zpClient.getLimits(TOKEN_ADDRESS, addr, false);
    }

    public async getMaxAvailableTransfer(amount: bigint, fee: bigint): Promise<bigint> {
        return await this.zpClient.calcMaxAvailableTransfer(TOKEN_ADDRESS, false);
    }

    public async minFee(amount: bigint, txType: TxType): Promise<bigint> {
        return await this.zpClient.atomicTxFee(TOKEN_ADDRESS);
    }

    public async estimateFee(amounts: bigint[], txType: TxType, updateState: boolean = true): Promise<FeeAmount> {
        return await this.zpClient.feeEstimate(TOKEN_ADDRESS, amounts, txType, updateState);
    }

    public getTransactionUrl(txHash: string): string {
        return this.client.getTransactionUrl(txHash);
    }

    public async depositShielded(amount: bigint): Promise<{jobId: string, txHash: string}> {
        let fromAddress = null;
        if (isSubstrateBased(NETWORK)) {
            fromAddress = await this.client.getPublicKey();
        }

        console.log('Waiting while state become ready...');
        const ready = await this.zpClient.waitReadyToTransact(TOKEN_ADDRESS);
        if (ready) {
            const txFee = (await this.zpClient.feeEstimate(TOKEN_ADDRESS, [amount], TxType.Deposit, false));

            if (isEvmBased(NETWORK)) {
                let totalApproveAmount = this.zpClient.shieldedAmountToWei(TOKEN_ADDRESS, amount + txFee.totalPerTx);
                const currentAllowance = await this.client.allowance(TOKEN_ADDRESS, CONTRACT_ADDRESS);
                if (totalApproveAmount > currentAllowance) {
                    totalApproveAmount -= currentAllowance;
                    console.log(`Increasing allowance for the Pool (${CONTRACT_ADDRESS}) to spend our tokens (+ ${this.weiToHuman(totalApproveAmount)} ${TOKEN_SYMBOL})`);
                    await this.client.increaseAllowance(TOKEN_ADDRESS, CONTRACT_ADDRESS, totalApproveAmount.toString());
                } else {
                    console.log(`Current allowance (${this.weiToHuman(currentAllowance)} ${TOKEN_SYMBOL}) is greater than needed (${this.weiToHuman(totalApproveAmount)} ${TOKEN_SYMBOL}). Skipping approve`);
                }
            }

            console.log('Making deposit...');
            const jobId = await this.zpClient.deposit(TOKEN_ADDRESS, amount, (data) => this.client.sign(data), fromAddress, txFee.totalPerTx);
            console.log('Please wait relayer provide txHash for job %s...', jobId);

            return {jobId, txHash: (await this.zpClient.waitJobTxHash(TOKEN_ADDRESS, jobId)) };
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
        let myAddress = null;
        if (isEvmBased(NETWORK)) {
            myAddress = await this.client.getAddress();
        } else {
            throw Error('Permittable token deposit is supported on the EVM networks only');
        }
        
        console.log('Waiting while state become ready...');
        const ready = await this.zpClient.waitReadyToTransact(TOKEN_ADDRESS);
        if (ready) {
            const txFee = (await this.zpClient.feeEstimate(TOKEN_ADDRESS, [amount], TxType.BridgeDeposit, false));

            console.log('Making deposit...');
            let jobId;
            jobId = await this.zpClient.depositPermittable(TOKEN_ADDRESS, amount, async (deadline, value, salt) => {
                const dataToSign = await this.createPermittableDepositData(TOKEN_ADDRESS, '1', myAddress, CONTRACT_ADDRESS, value, deadline, salt);
                return this.client.signTypedData(dataToSign)
            }, myAddress, txFee.totalPerTx);

            console.log('Please wait relayer provide txHash for job %s...', jobId);

            return {jobId, txHash: (await this.zpClient.waitJobTxHash(TOKEN_ADDRESS, jobId))};
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    public async depositShieldedPermittableEphemeral(amount: bigint, index: number): Promise<{jobId: string, txHash: string}> {
        let myAddress = null;
        if (isEvmBased(NETWORK)) {
            myAddress = await this.client.getAddress();
        } else {
            throw Error('Permittable token deposit is supported on the EVM networks only');
        }
        
        console.log('Waiting while state become ready...');
        const ready = await this.zpClient.waitReadyToTransact(TOKEN_ADDRESS);
        if (ready) {
            const txFee = (await this.zpClient.feeEstimate(TOKEN_ADDRESS, [amount], TxType.BridgeDeposit, false));

            console.log('Making deposit...');
            let jobId;
            jobId = await this.zpClient.depositPermittableEphemeral(TOKEN_ADDRESS, amount, index, txFee.totalPerTx);

            console.log('Please wait relayer complete the job %s...', jobId);

            return {jobId, txHash: (await this.zpClient.waitJobTxHash(TOKEN_ADDRESS, jobId))};
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    public async transferShielded(transfers: TransferRequest[]): Promise<{jobId: string, txHash: string}[]> {
        console.log('Waiting while state become ready...');
        const ready = await this.zpClient.waitReadyToTransact(TOKEN_ADDRESS);
        if (ready) {
            const amounts = transfers.map((oneTransfer) => oneTransfer.amountGwei);
            const txFee = (await this.zpClient.feeEstimate(TOKEN_ADDRESS, amounts, TxType.Transfer, false));
            
            console.log('Making transfer...');
            const jobIds: string[] = await this.zpClient.transferMulti(TOKEN_ADDRESS, transfers, txFee.totalPerTx);
            console.log('Please wait relayer provide txHash%s %s...', jobIds.length > 1 ? 'es for jobs' : ' for job', jobIds.join(', '));

            return await this.zpClient.waitJobsTxHashes(TOKEN_ADDRESS, jobIds);
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    public async withdrawShielded(amount: bigint, external_addr: string): Promise<{jobId: string, txHash: string}[]> {

        let address = null;
        if (external_addr == null) {
            if (isEvmBased(NETWORK)) {
                address = await this.client.getAddress();
            }

            if (isSubstrateBased(NETWORK)) {
                address = await this.client.getPublicKey();
            }
        } else {
            address = external_addr;
        }

        console.log('Waiting while state become ready...');
        const ready = await this.zpClient.waitReadyToTransact(TOKEN_ADDRESS);
        if (ready) {
            const txFee = (await this.zpClient.feeEstimate(TOKEN_ADDRESS, [amount], TxType.Transfer, false));

            console.log('Making withdraw...');
            const jobIds: string[] = await this.zpClient.withdrawMulti(TOKEN_ADDRESS, address, amount, txFee.totalPerTx);
            console.log('Please wait relayer provide txHash%s %s...', jobIds.length > 1 ? 'es for jobs' : ' for job', jobIds.join(', '));

            return await this.zpClient.waitJobsTxHashes(TOKEN_ADDRESS, jobIds);
        } else {
            console.log('Sorry, I cannot wait anymore. Please ask for relayer 😂');

            throw Error('State is not ready for transact');
        }
    }

    public async verifyShieldedAddress(shieldedAddress: string): Promise<boolean> {
        return await this.zpClient.verifyShieldedAddress(shieldedAddress);
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
