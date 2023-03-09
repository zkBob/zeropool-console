import bip39 from 'bip39-light';
import { HistoryRecord, HistoryTransactionType, ComplianceHistoryRecord,
         EphemeralAddress, PoolLimits, TxType,
 } from 'zkbob-client-js';
import { NetworkType } from 'zkbob-client-js/lib/network-type';
import { deriveSpendingKey, bufToHex, nodeToHex } from 'zkbob-client-js/lib/utils';
import { HistoryRecordState } from 'zkbob-client-js/lib/history';
import { TransferConfig } from 'zkbob-client-js';
import { TransferRequest, TreeState } from 'zkbob-client-js/lib/client';
import { ProverMode } from 'zkbob-client-js/lib/config';
import qrcodegen from "@ribpay/qr-code-generator";
import { toSvgString } from "@ribpay/qr-code-generator/utils";
import JSZip from "jszip";
import assert from 'assert';
var pjson = require('../package.json');

const bs58 = require('bs58');



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

export async function genShieldedAddress(number: string) {
    let addressNum = number !== undefined ? Number(number) : 1;
    this.pause();
    for (let i = 0; i < addressNum; i++) {
        const address = await this.account.genShieldedAddress();
        this.echo(`[[;gray;]${address}]`);
    }
    this.resume();
}

export async function shieldedAddressInfo(shieldedAddress: string) {
    const isValid = await this.account.verifyShieldedAddress(shieldedAddress);
    this.echo(`Verifying checksum: ${isValid ? '[[;green;]OK]' : '[[;red;]INCORRECT]'}`)
    if(isValid) {
        const isMy = await this.account.isMyAddress(shieldedAddress);
        this.echo(`Is it my address:   ${isMy ? '[[;green;]YES]' : '[[;white;]NO]'}`)

        let decoded: Uint8Array  = bs58.decode(shieldedAddress);
        let diversifier = decoded.slice(0, 10).reverse();
        let Gd = decoded.slice(10, -4).reverse();
        let chksm = decoded.slice(-4)
        this.echo(`Bytes:       [[;white;]${decoded.length}]`);
        this.echo(`Diversifier: [[;white;]${bufToHex(diversifier)}]`);
        this.echo(`Gd.x         [[;white;]${bufToHex(Gd)}]`);
        this.echo(`Checksum:    [[;white;]${bufToHex(chksm)}]`);
    }
}

export async function getBalance() {
    const [balance, readable] = await this.account.getBalance();
    this.echo(`[[;gray;]Balance: [[;white;]${readable} ${this.account.nativeSymbol()}] (${balance} wei)]`);
}

export async function getShieldedBalance() {
    this.pause();
    const [total, acc, note] = await this.account.getShieldedBalances(true);    // update state only once
    const optimisticBalance = await this.account.getOptimisticTotalBalance(false);

    this.echo(`[[;gray;]
[[;white;]Private balance: ${this.account.shieldedToHuman(total)} ${SHIELDED_TOKEN_SYMBOL}]
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
    this.echo(`Token balance: [[;white;]${human} ${TOKEN_SYMBOL}] (${balanceWei} wei)`);
}

export async function mint(amount: string) {
    this.pause();
    this.echo('Minting tokens... ');
    const txHash = await this.account.mint(this.account.humanToWei(amount));
    this.update(-1, `Minting tokens... [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
    this.resume();
}

export async function transfer(to: string, amount: string) {
    this.pause();
    this.echo(`Transfering ${this.account.nativeSymbol()}... `);
    const txHash = await this.account.transfer(to, this.account.humanToWei(amount));
    this.update(-1, `Transfering ${this.account.nativeSymbol()}... [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
    this.resume();
}

export async function transferToken(to: string, amount: string) {
    this.pause();
    this.echo(`Transfering ${TOKEN_SYMBOL}... `);
    const txHash = await this.account.transferToken(to, this.account.humanToWei(amount));
    this.update(-1, `Transfering ${TOKEN_SYMBOL}... [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
    this.resume();
}

export async function approveToken(spender: string, amount: string) {
    this.pause();
    this.echo(`Approving ${TOKEN_SYMBOL}... `);
    const txHash = await this.account.approveAllowance(spender, this.account.humanToWei(amount));
    this.update(-1, `Approving ${TOKEN_SYMBOL}... [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
    this.resume();
}

export async function getTxParts(amount: string, fee: string, requestAdditional: string) {
    let amounts: bigint[] = [];
    amounts.push(this.account.humanToShielded(amount));
    if (requestAdditional == '+' || fee == '+') {
        const additionalAmounts: string = await this.read('Enter additional space separated amounts (e.g. \'^1 ^2.34 ^50\'): ');
        let convertedAmounts: bigint[] = additionalAmounts.trim().split(/\s+/).map(add => this.account.humanToShielded(add));
        amounts = amounts.concat(convertedAmounts);
    }

    let actualFee: bigint;
    if (fee === undefined || fee == '+') {
        actualFee = await this.account.minFee();
    } else {
        actualFee = this.account.humanToShielded(fee);
    }
    
    this.pause();
    const result: TransferConfig[] = await this.account.getTxParts(amounts, actualFee);
    this.resume();

    if (amounts.length > 1) {
        this.echo(`Multi-destination request: ${ amounts.map(a => `^${this.account.shieldedToHuman(a)}`).join(', ') }`);
    }

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

    const multiTxColors = ['green', 'purple', 'yellow', 'aqua', 'olive', 'magenta', 'orange', 'pink', 'lime', 'salmon'];
    let lastDest = '';
    let curColorIdx = -1;

    for (let i = 0; i < result.length; i++) {
        const part = result[i];
        const notes = part.outNotes; //this.account.shieldedToHuman(part.amount);
        const partFee = this.account.shieldedToHuman(part.fee);
        let partLimit = "";
        if (part.accountLimit > 0) {
            partLimit = `, accountLimit = ${this.account.shieldedToHuman(part.accountLimit)} ${SHIELDED_TOKEN_SYMBOL}`;
        }

        const txTotalAmount = notes.map(note => note.amountGwei).reduce((acc, cur) => acc + cur, BigInt(0));
        if (notes.length == 0) {
            this.echo(`TX#${i} Aggregate notes: ${this.account.shieldedToHuman(part.inNotesBalance)} ${SHIELDED_TOKEN_SYMBOL} [fee: ${partFee}]${partLimit}`);
        } else {
            if (amounts.length > 1 || notes.length > 1) {
                this.echo(`TX#${i} ${this.account.shieldedToHuman(txTotalAmount)} ${SHIELDED_TOKEN_SYMBOL} [fee: ${partFee}]${partLimit}`);
                for (const aNote of notes) {
                    if(aNote.destination != lastDest) {
                        lastDest = aNote.destination;
                        curColorIdx = (curColorIdx + 1) % multiTxColors.length;
                    }
                    this.echo(`     [[;${multiTxColors[curColorIdx]};]${this.account.shieldedToHuman(aNote.amountGwei)}] ${SHIELDED_TOKEN_SYMBOL} -> ${aNote.destination}`);
                }
            } else {
                const color = (notes.length == 0 ? 'gray' : 'green');
                this.echo(`TX#${i} [[;${color};]${this.account.shieldedToHuman(txTotalAmount)}] ${SHIELDED_TOKEN_SYMBOL} [fee: ${partFee}]${partLimit}`);
            }
        }
    }
}

export async function estimateFeeDeposit(amount: string) {
    this.pause();
    const result = await this.account.estimateFee([this.account.humanToShielded(amount)], TxType.Deposit, false);
    this.resume();

    this.echo(`Total fee est.:    [[;white;]${this.account.shieldedToHuman(result.total)} ${TOKEN_SYMBOL}]`);
    this.echo(`Atomic fee:        [[;white;]${this.account.shieldedToHuman(result.totalPerTx)} (${this.account.shieldedToHuman(result.relayer)} + ${this.account.shieldedToHuman(result.l1)}) ${TOKEN_SYMBOL}]`);
    this.echo(`Transaction count: [[;white;]${result.txCnt}]`);
    this.echo(`Insuffic. balance: [[;white;]${result.insufficientFunds == true ? 'true' : 'false'}]`);
}

export async function estimateFeeTransfer(amount: string, requestAdditional: string) {
    let amounts: bigint[] = [];
    amounts.push(this.account.humanToShielded(amount));
    if (requestAdditional == '+') {
        const additionalAmounts: string = await this.read('Enter additional space separated amounts (e.g. \'^1 ^2.34 ^50\'): ');
        let convertedAmounts: bigint[] = additionalAmounts.trim().split(/\s+/).map(add => this.account.humanToShielded(add));
        amounts = amounts.concat(convertedAmounts);
    }

    this.pause();
    const result = await this.account.estimateFee(amounts, TxType.Transfer, false);
    this.resume();

    const effectiveAmount = amounts.reduce((acc, cur) => acc + cur, BigInt(0));

    this.echo(`Total fee est.:    [[;white;]${this.account.shieldedToHuman(result.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`Atomic fee:        [[;white;]${this.account.shieldedToHuman(result.totalPerTx)} (${this.account.shieldedToHuman(result.relayer)} + ${this.account.shieldedToHuman(result.l1)}) ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`Transaction count: [[;white;]${result.txCnt}`);
    this.echo(`Requested amount:  [[;white;]${this.account.shieldedToHuman(effectiveAmount)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`Insuffic. balance: [[;white;]${result.insufficientFunds == true ? 'true' : 'false'}]`);
}

export async function estimateFeeWithdraw(amount: string) {
    this.pause();
    const result = await this.account.estimateFee([this.account.humanToShielded(amount)], TxType.Withdraw, false);
    this.resume();

    this.echo(`Total fee est.:    [[;white;]${this.account.shieldedToHuman(result.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`Atomic fee:        [[;white;]${this.account.shieldedToHuman(result.totalPerTx)} (${this.account.shieldedToHuman(result.relayer)} + ${this.account.shieldedToHuman(result.l1)}) ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`Transaction count: [[;white;]${result.txCnt}]`);
    this.echo(`Insuffic. balance: [[;white;]${result.insufficientFunds == true ? 'true' : 'false'}]`);
}

export async function getLimits(address: string | undefined) {
    this.pause();
    const result: PoolLimits = await this.account.getLimits(address);
    this.resume();

    this.echo(`[[;white;]Max available deposit:  ${this.account.shieldedToHuman(result.deposit.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;gray;]...single operation:    ${this.account.shieldedToHuman(result.deposit.components.singleOperation)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;gray;]...address daily limit: ${this.account.shieldedToHuman(result.deposit.components.dailyForAddress.available)} / ${this.account.shieldedToHuman(result.deposit.components.dailyForAddress.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;gray;]...total daily limit:   ${this.account.shieldedToHuman(result.deposit.components.dailyForAll.available)} / ${this.account.shieldedToHuman(result.deposit.components.dailyForAll.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;gray;]...pool limit:          ${this.account.shieldedToHuman(result.deposit.components.poolLimit.available)} / ${this.account.shieldedToHuman(result.deposit.components.poolLimit.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;white;]Max available withdraw: ${this.account.shieldedToHuman(result.withdraw.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;gray;]...total daily limit:   ${this.account.shieldedToHuman(result.withdraw.components.dailyForAll.available)} / ${this.account.shieldedToHuman(result.withdraw.components.dailyForAll.total)} ${SHIELDED_TOKEN_SYMBOL}]`);
    this.echo(`[[;white;]Limits tier: ${result.tier}`);
    
}

export async function getMaxAvailableTransfer() {
    this.pause();
    const result = await this.account.getMaxAvailableTransfer();
    const human = this.account.shieldedToHuman(result);
    const wei = this.account.shieldedToWei(result);
    this.resume();

    this.echo(`Max available shielded balance for outcoming transactions: [[;white;]${human} ${SHIELDED_TOKEN_SYMBOL}] (${wei} wei)`);
}

export async function depositShielded(amount: string, times: string) {
    let txCnt = times !== undefined ? Number(times) : 1;

    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
        this.echo(`Performing shielded deposit${cntStr}...`);
        this.pause();
        const result = await this.account.depositShielded(this.account.humanToShielded(amount));
        this.resume();
        this.echo(`Done [job #${result.jobId}]: [[!;;;;${this.account.getTransactionUrl(result.txHash)}]${result.txHash}]`);
    }
}

export async function depositShieldedPermittable(amount: string, times: string) {
    let txCnt = times !== undefined ? Number(times) : 1;

    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
        this.echo(`Performing shielded deposit with permittable token${cntStr}...`);
        this.pause();

        // Due to the fact that the console is a test tool, we doesn't check address balance here
        // we should get ability to test relayer's behaviour
        const result = await this.account.depositShieldedPermittable(this.account.humanToShielded(amount));

        this.resume();
        this.echo(`Done [job #${result.jobId}]: [[!;;;;${this.account.getTransactionUrl(result.txHash)}]${result.txHash}]`);
    }
}

export async function depositShieldedPermittableEphemeral(amount: string, index: string) {
    let ephemeralIndex = index !== undefined ? Number(index) : 0;

    this.echo(`Getting ephemeral acount info...`);
    this.pause();
    let ephemeralAddress = await this.account.getEphemeralAddress(ephemeralIndex);
    this.update(-1, `Ephemeral address [[;white;]${ephemeralAddress.address}] has [[;white;]${this.account.shieldedToHuman(ephemeralAddress.tokenBalance)}] ${TOKEN_SYMBOL}`);

    // Ephemeral account balance will be checked inside a library sinse its resposibility for ephemeral pool
    this.echo(`Performing shielded deposit with permittable token from ephemeral address [[;white;]#${ephemeralIndex}]...`);
    const result = await this.account.depositShieldedPermittableEphemeral(this.account.humanToShielded(amount), ephemeralIndex);
    this.resume();
    this.echo(`Done [job #${result.jobId}]: [[!;;;;${this.account.getTransactionUrl(result.txHash)}]${result.txHash}]`);
}

export async function directDeposit(to: string, amount: string, times: string) {
    if ((await this.account.verifyShieldedAddress(to))) {
        let txCnt = times !== undefined ? Number(times) : 1;
        for (let i = 0; i < txCnt; i++) {
            let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : '';
            this.echo(`Performing direct deposit${cntStr}...`);
            this.pause();
            const txHash = await this.account.directDeposit(to, this.account.humanToShielded(amount));
            this.resume();
            this.echo(`Done: [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
        }
    } else {
        this.error(`Shielded address ${to} is invalid. Please check it!`);
    }
}

export async function transferShielded(to: string, amount: string, times: string) {
    if ((await this.account.verifyShieldedAddress(to)) === false) {
        this.error(`Shielded address ${to} is invalid. Please check it!`);
    } else {
        let txCnt = 1;
        let requests: TransferRequest[] = [];
        requests.push({ destination: to, amountGwei: this.account.humanToShielded(amount)});

        if (times == '+') {
            let newRequest = '';
            this.echo('[[;green;]Multi-destination mode. Provide new requests in format \'shielded_address amount\' (just press Enter to finish)]')
            do {
                newRequest = await this.read('[[;gray;]Enter additional request:] ');
                if (newRequest == '') break;
                const components = newRequest.trim().split(/\s+/);
                if (components.length != 2) {
                    this.error('Please use the following format: \'shielded_address amount\'');
                    continue;
                }
                if ((await this.account.verifyShieldedAddress(components[0])) === false) {
                    this.error(`Shielded address ${components[0]} is invalid. Please check it!`);
                    continue;
                }
                let newAmount: bigint;
                try {
                    newAmount = this.account.humanToShielded(components[1]);
                } catch (err) {
                    this.error(`Cannot convert \'${components[1]} to the number`);
                    continue;
                }

                requests.push({ destination: components[0], amountGwei: newAmount });
            } while(newRequest != '')

            this.update(-1, `Great! There ${requests.length==1 ? 'is' : 'are'} ${requests.length} request${requests.length==1 ? '' : 's'} collected!`);
        } else if (times !== undefined) {
            txCnt = Number(times);
        }

        for (let i = 0; i < txCnt; i++) {
            let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
            this.echo(`Performing shielded transfer${cntStr}...`);
            this.pause();
            const result = await this.account.transferShielded(requests);
            this.resume();
            this.echo(`Done ${result.map((oneResult) => {
                return `[job #${oneResult.jobId}]: [[!;;;;${this.account.getTransactionUrl(oneResult.txHash)}]${oneResult.txHash}]`
            }).join(`\n     `)}`);
            
        }
    };
}

export async function transferShieldedMultinote(to: string, amount: string, count: string, times: string) {
    if ((await this.account.verifyShieldedAddress(to)) === false) {
        this.error(`Shielded address ${to} is invalid. Please check it!`);
    } else {
        let notesCnt = Number(count);
        let txCnt = times !== undefined ? Number(times) : 1;
        if (notesCnt < 0) {
            this.error(`Please provide a positive notes count value (provided: ${notesCnt})`);
            return;
        }

        let requests: TransferRequest[] = [];
        for(let reqIdx = 0; reqIdx < notesCnt; reqIdx++) {
            requests.push({ destination: to, amountGwei: this.account.humanToShielded(amount)});
        }

        for (let i = 0; i < txCnt; i++) {
            let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
            this.echo(`Performing transfer with ${notesCnt} notes ${cntStr}...`);
            this.pause();
            const result = await this.account.transferShielded(requests);
            this.resume();
            this.echo(`Done ${result.map((oneResult) => {
                return `[job #${oneResult.jobId}]: [[!;;;;${this.account.getTransactionUrl(oneResult.txHash)}]${oneResult.txHash}]`
            }).join(`\n     `)}`);
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

export async function getRoot(index: string) {
    let idx: bigint | undefined = undefined;
    if (index !== undefined) {
        try {
            idx = BigInt(index);
        } catch (err) {
            this.error(`Cannot convert \'${idx} to the number`);
            return;
        }
    }

    let localState;
    let localTreeStartIndex = await this.account.getLocalTreeStartIndex();
    try {
        localState = await this.account.getLocalTreeState(idx);
    } catch (err) {
        this.error(`Cannot retrieve local root at index ${idx.toString()}: ${err}`);
        return;
    }

    let treeDescr = '';
    if (localTreeStartIndex !== undefined) {
        if (localTreeStartIndex > 0) {
            treeDescr = ` [tree filled from index ${localTreeStartIndex.toString()}]`;
        } else {
            treeDescr = ' [full tree]';
        }
    }

    this.echo(`Local Merkle Tree:  [[;white;]${localState.root.toString()} @${localState.index.toString()}]${treeDescr}`)

    this.echo(`Requesting additional info...`);
    this.pause();
    const relayerState = this.account.getRelayerTreeState();
    let relayerOptimisticState;
    if (idx === undefined) {
        relayerOptimisticState = this.account.getRelayerOptimisticTreeState();
    }
    const poolState = this.account.getPoolTreeState(idx);

    let promises = [relayerState, relayerOptimisticState, poolState]
    Promise.all(promises).then((states) => {
        if (relayerOptimisticState !== undefined) {
            this.update(-1, `Relayer:            [[;white;]${states[0].root.toString()} @${states[0].index.toString()}]`);
            this.echo(`Relayer optimistic: [[;white;]${states[1].root.toString()} @${states[1].index.toString()}]`);
            this.echo(`Pool  contract:     [[;white;]${states[2].root.toString()} @${states[2].index.toString()}]`);
        } else {
            this.update(-1, `Pool  contract:     [[;white;]${states[2].root.toString()} @${states[2].index.toString()}]`);
        }
    }).catch((reason) => {
        this.error(`Cannot fetch additional info: ${reason}`);
    }).finally(() => {
        this.resume();
    });
}

export async function getLeftSiblings(index: string) {
    let idx: bigint | undefined = undefined;
    try {
        idx = BigInt(index);
    } catch (err) {
        this.error(`Cannot convert \'${idx}\' to the bigint`);
        return;
    }

    this.pause();

    let siblings;
    try {
        siblings = await this.account.getTreeLeftSiblings(idx);
    } catch (err) {
        this.error(`Cannot get siblings: ${err}`);
        return;
    }
    
    this.echo(' height | index       | value');
    this.echo('-------------------------------------------------------------------------------------------------------');
    siblings.forEach(aNode => {
        const height = `${aNode.height}`.padEnd(7);
        const index = `${aNode.index}`.padEnd(12);
        this.echo(`[[;white;] ${height}]|[[;white;] ${index}]| ${aNode.value}`);
    });

    let relayerResponse = `[\n`;
    siblings.forEach((aNode, index) => {
        const hexNode = nodeToHex(aNode).slice(2);
        relayerResponse += `\t\"${hexNode}\"${index < siblings.length - 1 ? ',' : ''}\n`;
    });
    relayerResponse += `]`

    this.echo('[[;white;]Relayer response format:]');
    this.echo(`${relayerResponse}`);

    this.resume();

}

export async function rollback(index: string) {
    let idx: bigint | undefined = undefined;
    try {
        idx = BigInt(index);
    } catch (err) {
        this.error(`Cannot convert \'${idx}\' to the bigint`);
        return;
    }

    this.pause();
    const newNextIndex = await this.account.rollback(idx);
    this.echo(`New index:  [[;white;]${newNextIndex}]`);
    const newState: TreeState = await this.account.getLocalTreeState();
    this.echo(`New root:   [[;white;]${newState.root} @ ${newState.index}]`);
    const poolState: TreeState = await this.account.getPoolTreeState(newNextIndex);
    this.echo(`Pool root:  [[;white;]${poolState.root} @ ${poolState.index}]`);
    this.resume();
}

export async function syncState() {
    this.pause();
    const curState: TreeState = await this.account.getLocalTreeState();
    this.echo(`Starting sync from index: [[;white;]${curState.index}]`);

    const isReadyToTransact = await this.account.syncState();

    const newState: TreeState = await this.account.getLocalTreeState();
    this.echo(`Finished sync at index:   [[;white;]${newState.index}]`);
    this.echo(`Client ready to transact:  ${isReadyToTransact ? '[[;green;]YES]' : '[[;red;]NO]'}`);
    this.resume();
}

export async function getStateSyncStatistic() {
    this.pause();
    const fullSyncStat = await this.account.getStatFullSync();
    const avgTimePerTx = await this.account.getAverageTimePerTx();

    if (fullSyncStat !== undefined) {
        this.echo(`Full state sync: [[;white;]${fullSyncStat.totalTime / 1000} sec]`);
        this.echo(`  average speed:      [[;white;]${fullSyncStat.timePerTx.toFixed(1)} msec/tx]`);
        this.echo(`  total number of tx: [[;white;]${fullSyncStat.txCount}]`);
        this.echo(`  number of tx [CDN]: [[;white;]${fullSyncStat.cdnTxCnt}]`);
        this.echo(`  decrypted items:    [[;white;]${fullSyncStat.decryptedLeafs}]`);

    } else {
        this.echo(`Full state: [[;white;]N/A]`);
    }

    if (avgTimePerTx !== undefined) {
        this.echo(`Average sync speed: [[;white;]${avgTimePerTx.toFixed(1)} msec/tx]`);
    } else {
        this.echo(`Average sync speed: [[;white;]N/A]`);
    }

    this.resume();
}

export async function getEphemeral(index: string) {
    this.pause();
    let idx;
    if (index === undefined) {
        this.echo(`Getting first unused ephemeral address...`);
        idx = await this.account.getNonusedEphemeralIndex();
    } else {
        idx = Number(index);
    }

    const [addr, inTxCnt, outTxCnt] = await Promise.all([
        this.account.getEphemeralAddress(idx),
        this.account.getEphemeralAddressInTxCount(idx),
        this.account.getEphemeralAddressOutTxCount(idx),
    ]);

    this.echo(`Index: [[;white;]${addr.index}]`);
    this.echo(`  Address:            [[;white;]${addr.address}]`);
    this.echo(`  Token balance:      [[;white;]${this.account.shieldedToHuman(addr.tokenBalance)} ${TOKEN_SYMBOL}]`);
    this.echo(`  Native balance:     [[;white;]${this.account.shieldedToHuman(addr.nativeBalance)} ${this.account.nativeSymbol()}]`);
    this.echo(`  Transfers (in/out): [[;white;]${inTxCnt}]/[[;white;]${outTxCnt}]`);
    this.echo(`  Nonce [native]:     [[;white;]${addr.nativeNonce}]`);
    this.echo(`  Nonce [permit]:     [[;white;]${addr.permitNonce}]`);

    this.resume();
}

export async function getEphemeralUsed() {
    this.pause();

    let usedAddr: EphemeralAddress[] = await this.account.getUsedEphemeralAddresses();

    for (let addr of usedAddr) {
        const [inTxCnt, outTxCnt] = await Promise.all([
            this.account.getEphemeralAddressInTxCount(addr.index),
            this.account.getEphemeralAddressOutTxCount(addr.index),
        ]);

        this.echo(`Index: [[;white;]${addr.index}]`);
        this.echo(`  Address:            [[;white;]${addr.address}]`);
        this.echo(`  Token balance:      [[;white;]${this.account.shieldedToHuman(addr.tokenBalance)} ${TOKEN_SYMBOL}]`);
        this.echo(`  Native balance:     [[;white;]${this.account.shieldedToHuman(addr.nativeBalance)} ${this.account.nativeSymbol()}]`);
        this.echo(`  Transfers (in/out): [[;white;]${inTxCnt}]/[[;white;]${outTxCnt}]`);
        this.echo(`  Nonce [native]:     [[;white;]${addr.nativeNonce}]`);
        this.echo(`  Nonce [permit]:     [[;white;]${addr.permitNonce}]`);
    }

    this.resume();
}

export async function getEphemeralPrivKey(index: string) {
    this.pause();
    let idx = Number(index);
    let priv: string = await this.account.getEphemeralAddressPrivateKey(idx);
    this.echo(`Private key @${idx}: [[;white;]${priv}]`);
    this.resume();
}

export async function setProverMode(mode: ProverMode) {
    this.pause();
    await this.account.setProverMode(mode);
    this.echo(`Prover mode: ${this.account.getProverMode()}`);
    this.resume();
}

export async function getProverInfo() {
    this.pause();
    const proverMode = this.account.getProverMode();
    const delegatedProverUrl = DELEGATED_PROVER_URL;
    switch(proverMode) {
        case ProverMode.Local:
            this.echo(`Local Prover`);
            break;
        case ProverMode.Delegated:
            if (delegatedProverUrl) {
                this.echo(`Delegated Prover: ${delegatedProverUrl}`);
            } else {
                this.echo(`Delegated Prover: delegated prover url not provided`);
            }
            break;
        case ProverMode.DelegatedWithFallback:
            if (delegatedProverUrl) {
                this.echo(`Delegated Prover with fallback: ${delegatedProverUrl}`);
            } else {
                this.echo(`Delegated Prover with fallback: delegated prover url not provided`);
            }
            break;
    }

    if (proverMode != ProverMode.Local) {
        this.echo(`Current prover version:  ...fetching...`);

        try {
            const ver = await this.account.proverVersion();
            this.update(-1, `Current prover version:  [[;white;]${ver.ref} @ ${ver.commitHash}]`)
        } catch(err) {
            this.update(-1, `Current prover version:  [[;red;]${err.message}]`);
        }
    }
    this.resume();
}

export async function printHistory() {
    this.pause();
    const history: HistoryRecord[] = await this.account.getAllHistory();
    this.resume();

    const denominator = 1000000000;
    
    for (const tx of history) {
        this.echo(`${humanReadable(tx, denominator)} [[!;;;;${this.account.getTransactionUrl(tx.txHash)}]${tx.txHash}]`);

        if (tx.actions.length > 1) {
            let directions = new Map<string, {amount: bigint, notesCnt: number, isLoopback}>();
            for (const moving of tx.actions) {
                let existingDirection = directions.get(moving.to);
                if (existingDirection === undefined) {
                    existingDirection = {amount: BigInt(0), notesCnt: 0, isLoopback: moving.isLoopback};
                }
                existingDirection.amount += moving.amount;
                existingDirection.notesCnt++;
                directions.set(moving.to, existingDirection);
            }


            const prep = (tx.type == HistoryTransactionType.TransferIn || tx.type == HistoryTransactionType.DirectDeposit ) ? 'ON' : 'TO';
            for (let [key, value] of directions) {
                let notesCntDescription = '';
                if (value.notesCnt > 1) {
                    notesCntDescription = ` [${value.notesCnt} notes were used]`;
                }
                let destDescr = `${key}${notesCntDescription}`;
                if (value.isLoopback) {
                    destDescr = `MYSELF${notesCntDescription}`;
                }
                this.echo(`                                  ${Number(value.amount) / denominator} ${SHIELDED_TOKEN_SYMBOL} ${prep} ${destDescr}`);
            }
        }
        //this.echo(`RECORD ${tx.type} [[!;;;;${this.account.getTransactionUrl(tx.txHash)}]${tx.txHash}]`);
    }
}

function humanReadable(record: HistoryRecord, denominator: number): string {
    let dt = new Date(record.timestamp * 1000);

    let mainPart: string;
    let statusMark = ``;
    if (record.state == HistoryRecordState.Pending) {
        statusMark = `⌛ `;
    } else if (record.state == HistoryRecordState.RejectedByPool || record.state == HistoryRecordState.RejectedByRelayer) {
        statusMark = `❌ `;
    }

    if (record.actions.length > 0) {
        const totalAmount = record.actions.map(({ amount }) => amount).reduce((acc, cur) => acc + cur);
        let toAddress = record.actions[0].to;
        if (record.actions.length > 1) {
            toAddress = `${record.actions.length} notes`;
        } else if (
            record.type == HistoryTransactionType.TransferOut &&
            record.actions.length == 1 &&
            record.actions[0].isLoopback
        ) {
            toAddress = 'MYSELF';
        }

        if (record.type == HistoryTransactionType.Deposit) {
            mainPart = `${statusMark}DEPOSITED  ${Number(totalAmount) / denominator} ${TOKEN_SYMBOL} FROM ${record.actions[0].from}`;      
        } else if (record.type == HistoryTransactionType.TransferIn) {
            mainPart = `${statusMark}RECEIVED   ${Number(totalAmount) / denominator} ${SHIELDED_TOKEN_SYMBOL} ${record.actions.length > 1 ? 'IN' : 'ON'} ${toAddress}`;
        } else if (record.type == HistoryTransactionType.TransferOut) {
            mainPart = `${statusMark}SENT       ${Number(totalAmount) / denominator} ${SHIELDED_TOKEN_SYMBOL} ${record.actions.length > 1 ? 'IN' : 'TO'} ${toAddress}`;
        } else if (record.type == HistoryTransactionType.Withdrawal) {
            mainPart = `${statusMark}WITHDRAWN  ${Number(totalAmount) / denominator} ${SHIELDED_TOKEN_SYMBOL} TO ${toAddress}`;
        } else if (record.type == HistoryTransactionType.DirectDeposit) {
            mainPart = `${statusMark}DEPOSITED DIRECT ${Number(totalAmount) / denominator} ${SHIELDED_TOKEN_SYMBOL} ${record.actions.length > 1 ? 'IN' : 'ON'} ${toAddress}`;
        } else {
            mainPart = `${statusMark}UNKNOWN TRANSACTION TYPE (${record.type})`
        }

        if (record.fee > 0) {
        mainPart += `(fee = ${Number(record.fee) / denominator})`;
        }
    } else if (record.type == HistoryTransactionType.AggregateNotes) {
        mainPart = `${statusMark}AGGREGATE NOTES`;
    } else {
        mainPart = `incorrect history record`;
    }

    return `${dt.toLocaleString()} : ${mainPart}`;
}

export async function complianceReport() {
    this.echo('Please specify optional report interval. To omit the bound just press Enter');
    this.echo('Acceptable formats: ISO8601 ([[;white;]e.g. 2022-10-28 09:15:00]) or linux timestamp (e.g. [[;white;]1666937700])');
    const fromDate = await readDate(this, '[[;green;]Enter report START date time (press Enter to skip)]: ');
    const toDate = await readDate(this, '[[;green;]Enter report END date time (press Enter to skip)]:   ');
    //this.update(-1, `Great! There ${requests.length==1 ? 'is' : 'are'} ${requests.length} request${requests.length==1 ? '' : 's'} collected!`);
    const fromDescr = fromDate ? ` from ${fromDate}` : '';
    const toDescr = toDate ? ` up to  ${toDate}` : '';
    this.echo(`Generating compliance report${fromDescr}${toDescr}...`);

    this.pause();

    const report: ComplianceHistoryRecord[] = await this.account.generateComplianceReport(
        fromDate ? fromDate.getTime() : undefined, 
        toDate ? toDate.getTime() : undefined,
        );

    const genDate = new Date();

    const denominator = 1000000000;
    for (const aRecord of report) {
        this.echo(`[[;white;]${humanReadable(aRecord, denominator)}] [[!;;;;${this.account.getTransactionUrl(aRecord.txHash)}]${aRecord.txHash}]`);
        this.echo(`\tTx index:  ${aRecord.index}`);

        // Incoming transfer and direct deposit - are special cases:
        //  - the output account for incoming transfers cannot be decrypted
        //  - the nullifier doesn't take into account (it's not belong to us)
        //  - the next nullifier cannot be calculated without output account
        if (aRecord.type != HistoryTransactionType.TransferIn && 
            aRecord.type != HistoryTransactionType.DirectDeposit) 
        {
            this.echo(`\tNullifier: ${bufToHex(aRecord.nullifier)}`);
            if (aRecord.nextNullifier) {
                this.echo(`\tNext nullifier: ${bufToHex(aRecord.nextNullifier)}`);
            }

            this.echo(`\tAccount @${aRecord.index}: ${JSON.stringify(aRecord.acc)}`);

            let accEnc = aRecord.encChunks.find(obj => obj.index == aRecord.index)?.data;
            let accKey = aRecord.ecdhKeys.find(obj => obj.index == aRecord.index)?.key;
            if (accEnc && accKey) {
                this.echo(`\t      encrypted: ${bufToHex(accEnc)}`);
                this.echo(`\t      ECDH key:  ${bufToHex(accKey)}`);
            } else {
                this.echo(`[[;red;]Incorrect report: cannot find compliance details for account @${aRecord.index}]`);
            }
        }
        
        for (const aNote of aRecord.notes) {
            this.echo(`\tNote    @${aNote.index}: ${JSON.stringify(aNote.note)}`);

            if (aRecord.type != HistoryTransactionType.DirectDeposit) {
                let noteEnc = aRecord.encChunks.find(obj => obj.index == aNote.index)?.data;
                let noteKey = aRecord.ecdhKeys.find(obj => obj.index == aNote.index)?.key;
                if (noteEnc && noteKey) {
                    this.echo(`\t      encrypted: ${bufToHex(noteEnc)}`);
                    this.echo(`\t      ECDH key:  ${bufToHex(noteKey)}`);
                } else {
                    this.echo(`[[;red;]Incorrect report: cannot find compliance details for note @${aNote.index}]`);
                }
            }
        }

        const inputs = aRecord.inputs;
        if (inputs) {
            this.echo(`\t[[;green;]Input account @${inputs.account.index}:] ${JSON.stringify(inputs.account.account)}`);
            this.echo(`\t\t...intermediate nullifier hash: ${inputs.intermediateNullifier}`);
            for (const aNote of inputs.notes) {
                this.echo(`\t[[;green;]Input note    @${aNote.index}:] ${JSON.stringify(aNote.note)}`);
            }
        }
    }

    this.echo('[[;white;]--------------------------------END-OF-REPORT--------------------------------]\n');

    let metadata: any = {};
    metadata.userId = this.account.getAccountId();
    metadata.exportTimestamp = Math.floor(genDate.getTime() / 1000);
    metadata.startTimestamp = fromDate ? Math.floor(fromDate.getTime() / 1000) : null;
    metadata.endTimestamp = toDate ? Math.floor(toDate.getTime() / 1000) : null;
    metadata.recordsCount = report.length;

    const exportReport = {metadata, transactions: report};

    const space = 4;
    const replacer = (key, value) => {
        if (typeof value === 'bigint') {
            return value.toString() + 'n';
        } else if (value instanceof Object.getPrototypeOf(Uint8Array)) {
            return `${bufToHex(value)}`;
        }  else {
            return value;
        }
    }

    let zipFile = new JSZip();
    zipFile.file(`report_${metadata.userId.slice(0, 8)}_${dateStrForFilename(genDate)}.json`, JSON.stringify(exportReport, replacer, space));
    let zipped = await zipFile.generateAsync({ type: 'blob' })
    let reportUrl = window.URL.createObjectURL(new Blob([zipped], { type: "application/zip" }));

    if (fromDate) {
        this.echo(`The report time interval start: [[;white;]${fromDate.toLocaleString()}] (${Math.floor(fromDate.getTime() / 1000)})`); 
    }
    if (toDate) {
        this.echo(`The report time interval end:   [[;white;]${toDate.toLocaleString()}] (${Math.floor(toDate.getTime() / 1000)})`);
    }
    this.echo(`Records in report: [[;white;]${report.length}]`);
    this.echo(`Report was generated at: [[;white;]${genDate.toLocaleString()}] (${Math.floor(genDate.getTime() / 1000)})`);

    this.echo(`You could also [[!;;;;${reportUrl}]download raw report] now`); 

    this.resume();
    
}

function dateStrForFilename(date: Date): string {
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');

    return `${year}-${month}-${day}_${hour}-${min}`;
}

async function readDate(terminal: any, requestString: string): Promise<Date | null> {
    let datetimeStr: string = '';
    let date: Date | null = null;
    do {
        datetimeStr = await terminal.read(`${requestString}`);
        if (datetimeStr == '') break;
        datetimeStr = datetimeStr.trim();

        date = new Date(datetimeStr);
        if (!date || isNaN(date.valueOf())) {
            // maybe user entered a timestamp?
            let timestamp = Number(datetimeStr);
            if (timestamp) {
                if (timestamp < 10 ** 11) {
                    // seconds
                    timestamp *= 10 ** 3;
                } else if (timestamp < 10 ** 14) {
                    // milliseconds
                } else if (timestamp < 10 ** 16) {
                    // microseconds
                    timestamp /= 10 ** 3;
                } else {
                    // nanoseconds
                    timestamp /= 10 ** 6;
                }
                date = new Date(timestamp);
            }
        }

        if (!date || isNaN(date.valueOf())) {
            terminal.error(`Datetime is invalid. Use linux timestamp or ISO 8601 format (YYYY-MM-dd HH:mm:ss)`);
            datetimeStr = '';
            continue;
        }

    } while(datetimeStr == '');

    return date;
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

export function getAccountId() {
    this.pause();
    this.echo(`Account unique ID:  [[;white;]${this.account.getAccountId()}]`);
    this.resume();
}

export function getSupportId() {
    this.pause();
    this.echo(`Current Support ID:  [[;white;]${this.account.supportId}]`);
    this.resume();
}

export async function getVersion() {
    this.pause();
    this.echo(`zkBob console version:   [[;white;]${pjson.version}]`);
    this.echo(`Current relayer version: ...fetching...`);
    
    try {
        const ver = await this.account.relayerVersion();
        this.update(-1, `Current relayer version: [[;white;]${ver.ref} @ ${ver.commitHash}]`);
    } catch (err) {
        this.update(-1, `Current relayer version: [[;red;]${err.message}]`);
    }

    if (this.account.getProverMode() != ProverMode.Local) {
        this.echo(`Current prover version:  ...fetching...`);

        try {
            const ver = await this.account.proverVersion();
            this.update(-1, `Current prover version:  [[;white;]${ver.ref} @ ${ver.commitHash}]`)
        } catch(err) {
            this.update(-1, `Current prover version:  [[;red;]${err.message}]`);
        }
    }
    
    this.resume();
}

class GiftCard {
    alias: string;
    cloudId: string;
    // balance: number = 0;
    sk: string;
    address: string;
    svg: string;
    url:string;

    constructor(alias: string, cloudId: string, sk: string, address: string, svg: string, url: string) {
        // this.balance = 0;
        this.alias = alias
        this.cloudId = cloudId;
        this.sk = sk;
        this.address = address;
        this.svg = svg;
        this.url = url;
    }
}

export async function generateGiftCards(prefix: string, quantity: string, cardBalance: string, authToken: string) {

    this.pause();
    const cloudUrl = CLOUD_API_ENDPOINT;
    console.log("cloudUrl = ", cloudUrl)
    
    const singleCardBalance = this.account.humanToShielded(cardBalance)
    const requiredTotalSum = singleCardBalance * BigInt(quantity);
    await this.account.syncState();
    const txRequests = Array(Number(quantity)).fill(singleCardBalance);
    const fee = await this.account.estimateFee(txRequests, TxType.Transfer, true);
    if (fee.insufficientFunds) {
        const [balance] = await this.account.getShieldedBalances(false); // state already updated, do not sync again
        const requiredStr = `${this.account.shieldedToHuman(requiredTotalSum)} ${SHIELDED_TOKEN_SYMBOL}`;
        const feeStr = `${this.account.shieldedToHuman(fee.total)} ${SHIELDED_TOKEN_SYMBOL}`;
        const balanceStr = `${this.account.shieldedToHuman(balance)} ${SHIELDED_TOKEN_SYMBOL}`;
        this.echo(`[[;red;]Total card balance ${requiredStr} with required fee (${feeStr}) exceeds available funds (${balanceStr})]`);
        return;
    }
    const minTransferAmount = await this.account.minTxAmount();

    if (singleCardBalance < minTransferAmount) {
        const singleStr = `${this.account.shieldedToHuman(singleCardBalance)} ${SHIELDED_TOKEN_SYMBOL}`;
        const minAmountStr = `${this.account.shieldedToHuman(minTransferAmount)} ${SHIELDED_TOKEN_SYMBOL}`;
        this.echo(`[[;red;]Single card balance ${singleStr} less than minimum transfer amount ${minAmountStr}]`);
        return
    }

    const headers = new Headers();
    headers.append("Authorization", `Bearer ${authToken}`);
    headers.append("Content-Type", "application/json");
    let giftCards: GiftCard[] = [];
    const treeIndex = (await this.account.getPoolTreeState()).index
    try {
        this.echo(`Generating account${Number(quantity) > 1 ? 's' : ''}...`);
        for (let cardIndex = 0; cardIndex < Number(quantity); cardIndex++) {
            const alias = `${prefix}_${cardIndex}`;
            const body = JSON.stringify({ "description": `${alias}` });
            const signupResponse = await fetch(`${cloudUrl}/signup`, {
                method: 'POST',
                headers,
                body
            });
            if (signupResponse.status == 401) {
                throw new Error("not authorized to create new accounts, check admin token in environment variables")
            } else if (!signupResponse.ok) {
                throw new Error(`cloud wallet returned bad response ${signupResponse}` )
            }
            const signupResponseJson = await signupResponse.json();
            const cloudId = signupResponseJson.accountId;

            if(!cloudId) throw new Error("sign up response is invalid")
    
            const exportResponse = await fetch(`${cloudUrl}/export?id=${cloudId}`);

            if (!exportResponse.ok) throw new Error(`export failed ${exportResponse}`)

            const exportJson = await exportResponse.json();
            let sk = `0x${exportJson.sk}`;
    
            const generateAddressResponse = await fetch(`${cloudUrl}/generateAddress?id=${cloudId}`);

            if (!generateAddressResponse.ok) throw new Error(`generate address failed ${exportResponse}`);
            const generateAddressResponseJson = await generateAddressResponse.json();
            const address = generateAddressResponseJson.address;
            console.log(`generated new account with address: ${address} `);
    
            const url = redemptionUrl(sk, treeIndex);
            const svg = qrcode(url);
            giftCards.push(new GiftCard(alias, cloudId, sk, address, svg, url));
            if (Number(quantity) > 1) {
                this.update(-1, `Generating accounts...[${ Math.round((cardIndex + 1)*100/Number(quantity))}%]`);
            }
        }
        this.update(-1, `Generating account${Number(quantity) > 1 ? 's' : ''}...[[;green;]OK]`);
    
        let zipUrl = await zip(giftCards);
        this.echo(`Cards generated, [[!;;;;${zipUrl}]this archive] contains QR codes and summary report.\nSending funds ...`);    
        const transferRequests:TransferRequest[] = giftCards.map(
            giftCard =>  {return {
                destination: giftCard.address,
                amountGwei:this.account.humanToShielded(cardBalance) 
            }
        } );
        const result = await this.account.transferShielded(transferRequests);

        this.echo(`Transfer is [[;green;]DONE]:\n\t${result.map((singleTxResult: { jobId: any; txHash: any; }) => {
            return `[job #${singleTxResult.jobId}]: [[!;;;;${this.account.getTransactionUrl(singleTxResult.txHash)}]${singleTxResult.txHash}]`
        }).join(`\n     `)}`);
        
    } catch (error) {
        
        this.echo(`Process failed with error: [[;red;]${error.message}]`);

    }
    
    this.resume();

}

function redemptionUrl(sk: string, birthIndex: string): string {
    return `${GIFTCARD_REDEMPTION_URL}/?code=${sk}&index=${birthIndex}`
}

export function qrcode(data: string): string {


    const QRC = qrcodegen.QrCode;
    const qr0 = QRC.encodeText(data, QRC.Ecc.MEDIUM);
    const svg = toSvgString(qr0, 4, "#FFFFFF", "#000000");


    return svg
}


async function zip(giftCards: GiftCard[]) {

    let mainZip = new JSZip();
    giftCards.forEach(async giftCard => {

        mainZip.file(`${giftCard.cloudId}.${giftCard.alias}.svg`, giftCard.svg)
    })

    mainZip.file(`summary.json`, JSON.stringify({ summary: giftCards.map( card =>  {
        card.svg=""
        return card
    }) }))
    let zipped = await mainZip.generateAsync({ type: 'blob' })
    let url = window.URL.createObjectURL(new Blob([zipped], { type: "application/zip" }));
    return url
}