import Account from './account';
import bip39 from 'bip39-light';
import { HistoryRecord, HistoryTransactionType, PoolLimits, TxType } from 'zkbob-client-js';
import { NetworkType } from 'zkbob-client-js/lib/network-type';
import { deriveSpendingKey, verifyShieldedAddress, bufToHex } from 'zkbob-client-js/lib/utils';


export async function setSeed(seed: string, password: string) {
    await this.account.login(seed, password);
}

export function getSeed(password: string) {
    const seed = this.account.getSeed(password);
    this.echo(`[[;gray;]Seed phrase: ${seed}]`);
}

export function genSeed() {
    const seed = bip39.generateMnemonic();
    this.echo(`[[;gray;]Generated mnemonic: ${seed}]`);
}

export function getSk(password: string) {
    const seed = this.account.getSeed(password);
    const networkType = NETWORK as NetworkType;
    const sk = deriveSpendingKey(seed, networkType);
    this.echo(`[[;gray;]Spending key: 0x${bufToHex(sk)}]`);
}

export async function getAddress() {
    const address = await this.account.getRegularAddress();
    this.echo(`[[;gray;]Address: ${address}]`);
}

export function genShieldedAddress() {
    const address = this.account.genShieldedAddress();
    this.echo(`[[;gray;]${address}]`);
}

export async function getBalance() {
    const [balance, readable] = await this.account.getBalance();
    this.echo(`[[;gray;]Balance: ${readable} ${this.account.nativeSymbol()} (${balance} wei)]`);
}

export async function getShieldedBalance() {
    this.pause();
    const [total, acc, note] = await this.account.getShieldedBalances(true);    // update state only once
    const optimisticBalance = await this.account.getOptimisticTotalBalance(false);

    this.echo(`[[;gray;]
Private balance: ${this.account.shieldedToHuman(total)} ${SHIELDED_TOKEN_SYMBOL} (${this.account.shieldedToWei(total)} wei)
      - account: ${this.account.shieldedToHuman(acc)} ${SHIELDED_TOKEN_SYMBOL} (${this.account.shieldedToWei(acc)} wei)
      - note:    ${this.account.shieldedToHuman(note)} ${SHIELDED_TOKEN_SYMBOL} (${this.account.shieldedToWei(note)} wei)
]`);

    if (total != optimisticBalance) {
        this.echo(`[[;green;]Optimistic private balance: ${this.account.shieldedToHuman(optimisticBalance)} ${SHIELDED_TOKEN_SYMBOL} (${this.account.shieldedToWei(optimisticBalance)} wei)
]`);
    }

    this.resume();
}

export async function getTokenBalance() {
    const balanceWei = await this.account.getTokenBalance();
    const human = this.account.weiToHuman(balanceWei);
    this.echo(`[[;gray;]Token balance: ${human} ${TOKEN_SYMBOL} (${balanceWei} wei)]`);
}

export async function mint(amount: string) {
    return this.account.mint(this.account.humanToWei(amount));
}

export async function transfer(to: string, amount: string) {
    await this.account.transfer(to, this.account.humanToWei(amount));
}

export async function getTxParts(amount: string, fee: string) {
    this.pause();
    let actualFee: bigint;
    if (fee === undefined) {
        actualFee = await this.account.minFee();
    } else {
        actualFee = this.account.humanToShielded(fee);
    }
    const result = await this.account.getTxParts(this.account.humanToShielded(amount), actualFee);
    this.resume();

    if (result.length == 0) {
        this.echo(`Cannot create such transaction (insufficient funds or amount too small)`);
    } else {
        let totalFee = BigInt(0);
        for (const part of result) {
            totalFee += part.fee;
        }

        if (result.length == 1) {
            this.echo(`You can transfer or withdraw this amount within single transaction`);
        } else {
            this.echo(`Multitransfer detected. To transfer this amount will require ${result.length} txs`);
        }
        this.echo(`Fee required: ${this.account.shieldedToHuman(totalFee)} ${SHIELDED_TOKEN_SYMBOL}`);
    }

    for (const part of result) {
        const partAmount = this.account.shieldedToHuman(part.amount);
        const partFee = this.account.shieldedToHuman(part.fee);
        let partLimit = "";
        if (part.accountLimit > 0) {
            partLimit = `, accountLimit = ${this.account.shieldedToHuman(part.accountLimit)} ${SHIELDED_TOKEN_SYMBOL}`;
        }
        this.echo(`${partAmount} ${SHIELDED_TOKEN_SYMBOL} [fee: ${partFee}]${partLimit}`);
    }
}

export async function estimateFeeDeposit(amount: string) {
    this.pause();
    const result = await this.account.estimateFee(this.account.humanToShielded(amount), TxType.Deposit, false);
    this.resume();

    this.echo(`Total fee est.:    ${this.account.shieldedToHuman(result.total)} ${TOKEN_SYMBOL}`);
    this.echo(`Atomic fee:        ${this.account.shieldedToHuman(result.totalPerTx)} (${this.account.shieldedToHuman(result.relayer)} + ${this.account.shieldedToHuman(result.l1)}) ${TOKEN_SYMBOL}`);
    this.echo(`Transaction count: ${result.txCnt}`);
    this.echo(`Insuffic. balance: ${result.insufficientFunds == true ? 'true' : 'false'}`);
}

export async function estimateFeeTransfer(amount: string) {
    this.pause();
    const result = await this.account.estimateFee(this.account.humanToShielded(amount), TxType.Transfer, false);
    this.resume();

    this.echo(`Total fee est.:    ${this.account.shieldedToHuman(result.total)} ${SHIELDED_TOKEN_SYMBOL}`);
    this.echo(`Atomic fee:        ${this.account.shieldedToHuman(result.totalPerTx)} (${this.account.shieldedToHuman(result.relayer)} + ${this.account.shieldedToHuman(result.l1)}) ${SHIELDED_TOKEN_SYMBOL}`);
    this.echo(`Transaction count: ${result.txCnt}`);
    this.echo(`Insuffic. balance: ${result.insufficientFunds == true ? 'true' : 'false'}`);
}

export async function estimateFeeWithdraw(amount: string) {
    this.pause();
    const result = await this.account.estimateFee(this.account.humanToShielded(amount), TxType.Withdraw, false);
    this.resume();

    this.echo(`Total fee est.:    ${this.account.shieldedToHuman(result.total)} ${SHIELDED_TOKEN_SYMBOL}`);
    this.echo(`Atomic fee:        ${this.account.shieldedToHuman(result.totalPerTx)} (${this.account.shieldedToHuman(result.relayer)} + ${this.account.shieldedToHuman(result.l1)}) ${SHIELDED_TOKEN_SYMBOL}`);
    this.echo(`Transaction count: ${result.txCnt}`);
    this.echo(`Insuffic. balance: ${result.insufficientFunds == true ? 'true' : 'false'}`);
}

export async function getLimits(address: string | undefined) {
    this.pause();
    const result: PoolLimits = await this.account.getLimits(address);
    this.resume();

    this.echo(`[[;white;]Max available deposit:  ${this.account.shieldedToHuman(result.deposit.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;gray;]...single operation:    ${this.account.shieldedToHuman(result.deposit.components.singleOperation)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;gray;]...address day limit:   ${this.account.shieldedToHuman(result.deposit.components.daylyForAddress.available)} / ${this.account.shieldedToHuman(result.deposit.components.daylyForAddress.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;gray;]...total day limit:     ${this.account.shieldedToHuman(result.deposit.components.daylyForAll.available)} / ${this.account.shieldedToHuman(result.deposit.components.daylyForAll.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;gray;]...pool limit:          ${this.account.shieldedToHuman(result.deposit.components.poolLimit.available)} / ${this.account.shieldedToHuman(result.deposit.components.poolLimit.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;white;]Max available withdraw: ${this.account.shieldedToHuman(result.withdraw.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;gray;]...total day limit:     ${this.account.shieldedToHuman(result.withdraw.components.daylyForAll.available)} / ${this.account.shieldedToHuman(result.withdraw.components.daylyForAll.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;white;]Limits tier: ${result.tier}`);
    
}

export async function withdrawLimit(toAddress: string) {
    this.pause();
    const result = await this.account.getMaxWithdraw(toAddress);
    const human = this.account.shieldedToHuman(result);
    const wei = this.account.shieldedToWei(result);
    this.resume();

    this.echo(`[[;gray;]Max available withdraw: ${human} ${SHIELDED_TOKEN_SYMBOL} (${wei} wei)]`);
}

export async function getMaxAvailableTransfer() {
    this.pause();
    const result = await this.account.getMaxAvailableTransfer();
    const human = this.account.shieldedToHuman(result);
    const wei = this.account.shieldedToWei(result);
    this.resume();

    this.echo(`[[;gray;]Max available shielded balance for outcoming transactions: ${human} ${SHIELDED_TOKEN_SYMBOL} (${wei} wei)]`);
}

export async function depositShielded(amount: string, times: string) {
    let txCnt = times !== undefined ? Number(times) : 1;

    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
        this.echo(`Performing shielded deposit${cntStr}...`);
        this.pause();
        const result = await this.account.depositShielded(this.account.humanToShielded(amount));
        this.resume();
        this.echo(`Done [job #${result.jobId}]: ${result.txHashes.map((txHash: string) => {
                return `[[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`;
            }).join(`, `)}`);
    }
}

export async function depositShieldedPermittable(amount: string, times: string) {
    let txCnt = times !== undefined ? Number(times) : 1;

    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
        this.echo(`Performing shielded deposit with permittable token${cntStr}...`);
        this.pause();
        const result = await this.account.depositShieldedPermittable(this.account.humanToShielded(amount));
        this.resume();
        this.echo(`Done [job #${result.jobId}]: ${result.txHashes.map((txHash: string) => {
                return `[[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`;
            }).join(`, `)}`);
    }
}

export async function transferShielded(to: string, amount: string, times: string) {
    if (verifyShieldedAddress(to) === false) {
        this.error(`Shielded address ${to} is invalid. Please check it!`);
    } else {
        let txCnt = times !== undefined ? Number(times) : 1;

        for (let i = 0; i < txCnt; i++) {
            let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
            this.echo(`Performing shielded transfer${cntStr}...`);
            this.pause();
            const result = await this.account.transferShielded(to, this.account.humanToShielded(amount));
            this.resume();
            this.echo(`Done ${result.map((oneResult) => {
                return `[job #${oneResult.jobId}]: [[!;;;;${this.account.getTransactionUrl(oneResult.txHash)}]${oneResult.txHash}]`
            }).join(`\n      `)}`);
            
        }
    };
}

export async function transferShieldedMultinote(to: string, amount: string, count: string, times: string) {
    if (verifyShieldedAddress(to) === false) {
        this.error(`Shielded address ${to} is invalid. Please check it!`);
    } else {
        let txCnt = times !== undefined ? Number(times) : 1;

        for (let i = 0; i < txCnt; i++) {
            let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
            this.echo(`Performing transfer with ${count} notes ${cntStr}...`);
            this.pause();
            const result = await this.account.transferShieldedMultinote(to, this.account.humanToShielded(amount), Number(count));
            this.resume();
            this.echo(`Done [job #${result.jobId}]: ${result.txHashes.map((txHash: string) => {
                return `[[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`;
            }).join(`, `)}`);
        }
    };
}

export async function withdrawShielded(amount: string, address: string, times: string) {
    let txCnt = times !== undefined ? Number(times) : 1;

    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
        this.echo(`Performing shielded withdraw${cntStr}...`);
        this.pause();
        const result = await this.account.withdrawShielded(this.account.humanToShielded(amount), address);
        this.resume();
        this.echo(`Done ${result.map((oneResult) => {
            return `[job #${oneResult.jobId}]: [[!;;;;${this.account.getTransactionUrl(oneResult.txHash)}]${oneResult.txHash}]`
        }).join(`\n      `)}`);
    }
}

export async function getInternalState() {
    const state = await this.account.getInternalState();
    
    for (const [index, tx] of state.txs) {
        this.echo(`${index}: ${JSON.stringify(tx)}`);
    }
}

export async function printHistory() {
    this.pause();
    const history: HistoryRecord[] = await this.account.getAllHistory();
    this.resume();
    
    for (const tx of history) {
        this.echo(`${humanReadable(tx, 1000000000)} [[!;;;;${this.account.getTransactionUrl(tx.txHash)}]${tx.txHash}]`);
    }
}

function humanReadable(record: HistoryRecord, denominator: number): string {
    let dt = new Date(record.timestamp * 1000);

    let mainPart: string;
    let pendingMark = ``;
    if (record.pending) {
        pendingMark = `⌛ `;
    }
    if (record.type == HistoryTransactionType.Deposit) {
      mainPart = `${pendingMark}DEPOSITED  ${Number(record.amount) / denominator} ${TOKEN_SYMBOL} FROM ${record.from}`;      
    } else if (record.type == HistoryTransactionType.TransferIn) {
      mainPart = `${pendingMark}RECEIVED   ${Number(record.amount) / denominator} ${SHIELDED_TOKEN_SYMBOL} ON ${record.to}`;
    } else if (record.type == HistoryTransactionType.TransferOut) {
      mainPart = `${pendingMark}SENDED     ${Number(record.amount) / denominator} ${SHIELDED_TOKEN_SYMBOL} TO ${record.to}`;
    } else if (record.type == HistoryTransactionType.Withdrawal) {
      mainPart = `${pendingMark}WITHDRAWED ${Number(record.amount) / denominator} ${SHIELDED_TOKEN_SYMBOL} TO ${record.to}`;
    } else if (record.type == HistoryTransactionType.TransferLoopback) {
      mainPart = `${pendingMark}SENDED     ${Number(record.amount) / denominator} ${SHIELDED_TOKEN_SYMBOL} TO MYSELF`;
    } else {
      mainPart = `${pendingMark}UNKNOWN TRANSACTION TYPE (${record.type})`
    }

    if (record.fee > 0) {
      mainPart += `(fee = ${Number(record.fee) / denominator})`;
    }

    return `${dt.toLocaleString()} : ${mainPart}`;
}

export function cleanState() {
    this.pause();
    this.account.cleanInternalState();
    this.resume();
}


export function clear() {
    this.clear();
}

export function reset() {
    this.account = null;
    this.reset();
}
