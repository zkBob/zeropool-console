import bip39 from 'bip39-light';
import { EphemeralAddress, HistoryRecord, HistoryTransactionType, ComplianceHistoryRecord, PoolLimits, TxType,
         TransferConfig, TransferRequest, TreeState, ProverMode, HistoryRecordState, GiftCardProperties, FeeAmount,
         deriveSpendingKeyZkBob,
         DirectDepositType
        } from 'zkbob-client-js';
import { bufToHex, nodeToHex, hexToBuf } from 'zkbob-client-js/lib/utils';
import qrcodegen from "@ribpay/qr-code-generator";
import { toSvgString } from "@ribpay/qr-code-generator/utils";
import JSZip from "jszip";
import { env } from './environment';
import { Account } from './account';
import sha256 from 'fast-sha256';
var pjson = require('../package.json');

const bs58 = require('bs58');


export async function currentPoolEnvironment() {
    const curPool = await this.account.getCurrentPool();
    const poolEnv = env.pools[curPool];
    const chainEnv = env.chains[String(poolEnv.chainId)];

    this.echo(`Current pool: ${curPool}`);
    this.echo(`Chain:        ${this.account.networkName()} (${poolEnv.chainId})`)
    this.echo(`Pool address:     [[!;;;;${this.account.getAddressUrl(poolEnv.poolAddress)}]${poolEnv.poolAddress}]`);
    this.echo(`Token address:    [[!;;;;${this.account.getAddressUrl(poolEnv.tokenAddress)}]${poolEnv.tokenAddress}]`);
    this.echo(`RPC endpoint${chainEnv.rpcUrls.length > 1 ? 's' : ''}:     ${chainEnv.rpcUrls.join(', ')}`);
    this.echo(`Relayer${poolEnv.relayerUrls.length > 1 ? 's' : ''}:          ${poolEnv.relayerUrls.join(', ')}`);
    this.echo(`Cold storage:     ${poolEnv.coldStorageConfigPath}`);
    this.echo(`Delegated prover${poolEnv.delegatedProverUrls.length > 1 ? 's' : ''}: ${poolEnv.delegatedProverUrls.join(', ')}`);
    this.echo(`Minter:           ${env.minters[curPool]}`);
    this.echo(`Cloud API:        ${env.cloudApi[curPool]}`);
    this.echo(`UI URL:           ${env.redemptionUrls[curPool]}`);
}

export async function getAvailablePools() {
    const pools: string[] = await this.account.getPools();
    this.echo(`Available pools: ${pools.join(', ')}`);
}

export async function switchPool(poolAlias: string, password: string) {
    if (!poolAlias) {
        const pools: string[] = await this.account.getPools();
        this.echo(`[[;red;]Please provide a pool alias. Currently supported: ${pools.join(', ')}]`)
        return;
    }
    if (!password) {
        this.set_mask(true);
        password = (await this.read('Enter account password to switch L1 client: ')).trim();
        this.set_mask(false);
    }


    this.pause();
    await this.account.switchPool(poolAlias, password);
    this.resume();
    this.echo(`Current pool: ${await this.account.getCurrentPool()}`);
}

export async function getSeed(password: string) {
    if (!password) {
        this.set_mask(true);
        password = (await this.read('Enter account password: ')).trim();
        this.set_mask(false);
    }

    const seed = this.account.getSeed(this.account.accountName, password);
    this.echo(`[[;gray;]Seed phrase: ${seed}]`);
}

export async function getSk(password: string) {
    if (!password) {
        this.set_mask(true);
        password = (await this.read('Enter account password: ')).trim();
        this.set_mask(false);
    }

    const seed = this.account.getSeed(this.account.accountName, password);
    const sk = deriveSpendingKeyZkBob(seed);
    this.echo(`[[;gray;]Spending key: 0x${bufToHex(sk)}]`);
}

export async function getAddress() {
    const address = await this.account.getRegularAddress();
    this.echo(`[[;gray;]Address:] [[!;;;;${this.account.getAddressUrl(address)}]${address}]`);
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

export async function genShieldedAddressUniversal(number: string) {
    let addressNum = number !== undefined ? Number(number) : 1;
    this.pause();
    for (let i = 0; i < addressNum; i++) {
        const address = await this.account.genShieldedAddressUniversal();
        this.echo(`[[;gray;]${address}]`);
    }
    this.resume();
}

export async function shieldedAddressInfo(shieldedAddress: string) {
    this.echo('Parsing address...');
    try {
        const components = await this.account.zkAddressInfo(shieldedAddress);
        this.update(-1, 'Parsing address... [[;green;]OK]');
        this.echo(`Address format:    [[;white;]${components.format}]`);
        this.echo(`Is it derived from my SK:    ${components.derived_from_our_sk ? '[[;green;]YES]' : '[[;white;]NO]'}`);
        const isValid = await this.account.verifyShieldedAddress(shieldedAddress);
        this.echo(`Is it valid on current pool: ${isValid ? '[[;green;]YES]' : '[[;red;]NO]'}`);
        try {
            const poolId = BigInt(components.pool_id);
            this.echo(`Valid on the pool with ID:   [[;white;]0x${poolId.toString(16)}]`);
        } catch(err) {
            this.echo(`Valid on the pool with ID:   [[;white;]any pool]`);
        }


        this.echo(`Diversifier: [[;white;]${components.d}] (dec)`);
        this.echo(`Gd.x         [[;white;]${components.p_d}] (dec)`);
        this.echo(`Checksum:    [[;white;]${bufToHex(components.checksum)}] (hex)`);
    } catch(err) {
        this.update(-1, `Parsing address... [[;red;]${err.message}]`);
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
[[;white;]Private balance: ${await this.account.shieldedToHuman(total)} ${this.account.shTokenSymbol()}]
      - account: ${await this.account.shieldedToHuman(acc)} ${this.account.shTokenSymbol()} (${await this.account.shieldedToWei(acc)} wei)
      - note:    ${await this.account.shieldedToHuman(note)} ${this.account.shTokenSymbol()} (${await this.account.shieldedToWei(note)} wei)
]`);

    if (total != optimisticBalance) {
        this.echo(`[[;green;]Optimistic private balance: ${await this.account.shieldedToHuman(optimisticBalance)} ${this.account.shTokenSymbol()} (${await this.account.shieldedToWei(optimisticBalance)} wei)
]`);
    }

    this.resume();
}

export async function getTokenBalance() {
    const balanceWei = await this.account.getTokenBalance();
    const human = await this.account.weiToHuman(balanceWei);
    this.echo(`Token balance: [[;white;]${human} ${this.account.tokenSymbol()}] (${balanceWei} wei)`);
}

export async function getTokenAllowance(spender: string) {
    this.pause();
    const tokenAddress = this.account.getTokenAddr();
    this.echo(`Checking [[!;;;;${this.account.getAddressUrl(tokenAddress)}]token] allowance for [[!;;;;${this.account.getAddressUrl(spender)}]${spender}]... `);
    const allowance = await this.account.getTokenAllowance(spender);
    if (allowance == 0n) {
        this.echo(`[[;red;]There are no approved tokens for the provided address]`);    
    } else {
        this.update(-1, `The spender can spend up to [[;white;]${await this.account.weiToHuman(allowance)} ${this.account.shTokenSymbol()}]`);
    }
    this.resume();
}

export async function mint(amount: string) {
    this.pause();
    this.echo('Minting tokens... ');
    const txHash = await this.account.mint(await this.account.humanToWei(amount));
    this.update(-1, `Minting tokens... [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
    this.resume();
}

export async function transfer(to: string, amount: string) {
    this.pause();
    this.echo(`Transfering ${this.account.nativeSymbol()}... `);
    const txHash = await this.account.transfer(to, this.account.humanToEthWei(amount));
    this.update(-1, `Transfering ${this.account.nativeSymbol()}... [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
    this.resume();
}

export async function transferToken(to: string, amount: string) {
    this.pause();
    this.echo(`Transfering ${this.account.tokenSymbol()}... `);
    const txHash = await this.account.transferToken(to, await this.account.humanToWei(amount));
    this.update(-1, `Transfering ${this.account.tokenSymbol()}... [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
    this.resume();
}

export async function approveToken(spender: string, amount: string) {
    this.pause();
    this.echo(`Approving ${this.account.tokenSymbol()}... `);
    const txHash = await this.account.approveAllowance(spender, await this.account.humanToWei(amount));
    this.update(-1, `Approving ${this.account.tokenSymbol()}... [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
    this.resume();
}

export async function getTxParts(...amounts: string[]) {
    const amountsBN: bigint[] = await Promise.all(amounts.map(amount => this.account.humanToShielded(amount)));

    let entered = '';
    let txType = TxType.Transfer;
    this.echo(`[[;yellow;]Fee for transfer and withdraw transactions may vary]`)
    this.resume();
    do {
        entered = (await this.read('Please specify tx type ([t]ransfer(default) or [w]ithdraw): ')).toLowerCase();
        if (entered == 't' || entered == 'transfer') {
            txType = TxType.Transfer;
            break;
        } else if (entered == 'w' || entered == 'withdraw') {
            txType = TxType.Withdraw;
            break;
        }
    } while(entered != '');
    const txName = txType == TxType.Transfer ? 'transfer' : 'withdraw';
    
    this.pause();
    const result: TransferConfig[] = await this.account.getTxParts(txType, amountsBN);
    this.resume();

    if (amounts.length > 1) {
        const humanReadAmounts = await Promise.all(amountsBN.map(async a => `^${await this.account.shieldedToHuman(a)}`)); 
        this.echo(`Multi-destination request: ${humanReadAmounts.join(', ')}`);
    }

    if (result.length == 0) {
        this.echo(`Cannot create such ${txName} transaction (insufficient funds or amount too small)`);
    } else {
        let totalFee = BigInt(0);
        for (const part of result) {
            totalFee += part.fee;
        }

        if (result.length == 1) {
            this.echo(`You can ${txName} this amount within single transaction`);
        } else {
            this.echo(`Multitransfer detected. To ${txName} this amount will require ${result.length} txs`);
        }
        this.echo(`Fee required: ${await this.account.shieldedToHuman(totalFee)} ${this.account.shTokenSymbol()}`);
    }

    const multiTxColors = ['green', 'purple', 'yellow', 'aqua', 'olive', 'magenta', 'orange', 'pink', 'lime', 'salmon'];
    let lastDest = '';
    let curColorIdx = -1;

    for (let i = 0; i < result.length; i++) {
        const part = result[i];
        const notes = part.outNotes;
        const partFee = await this.account.shieldedToHuman(part.fee);
        let partLimit = "";
        if (part.accountLimit > 0) {
            partLimit = `, accountLimit = ${await this.account.shieldedToHuman(part.accountLimit)} ${this.account.shTokenSymbol()}`;
        }

        const txTotalAmount = notes.map(note => note.amountGwei).reduce((acc, cur) => acc + cur, BigInt(0));
        if (notes.length == 0) {
            this.echo(`TX#${i} Aggregate notes: ${await this.account.shieldedToHuman(part.inNotesBalance)} ${this.account.shTokenSymbol()} [fee: ${partFee}]${partLimit}`);
        } else {
            if (amounts.length > 1 || notes.length > 1) {
                this.echo(`TX#${i} ${await this.account.shieldedToHuman(txTotalAmount)} ${this.account.shTokenSymbol()} [fee: ${partFee}]${partLimit}`);
                for (const aNote of notes) {
                    if(aNote.destination != lastDest) {
                        lastDest = aNote.destination;
                        curColorIdx = (curColorIdx + 1) % multiTxColors.length;
                    }
                    this.echo(`     [[;${multiTxColors[curColorIdx]};]${await this.account.shieldedToHuman(aNote.amountGwei)}] ${this.account.shTokenSymbol()} -> ${aNote.destination}`);
                }
            } else {
                const color = (notes.length == 0 ? 'gray' : 'green');
                this.echo(`TX#${i} [[;${color};]${await this.account.shieldedToHuman(txTotalAmount)}] ${this.account.shTokenSymbol()} [fee: ${partFee}]${partLimit}`);
            }
        }
    }
}

export async function estimateFeeDeposit(amount: string) {
    this.pause();
    const result: FeeAmount = await this.account.estimateFee([await this.account.humanToShielded(amount ?? '0')], TxType.BridgeDeposit, false);
    this.resume();

    this.echo(`Total fee est.:     [[;white;]${await this.account.shieldedToHuman(result.total)} ${this.account.tokenSymbol()}]`);
    this.echo(`Fee components:     [[;white;](${await this.account.shieldedToHuman(result.relayerFee.fee)} per tx + ${await this.account.shieldedToHuman(result.relayerFee.oneByteFee)} per byte) ${this.account.tokenSymbol()}]`);
    this.echo(`Total calldata len: [[;white;]${result.calldataTotalLength} bytes]`);
    this.echo(`Transaction count:  [[;white;]${result.txCnt}]`);
    this.echo(`Insuffic. balance:  [[;white;]${result.insufficientFunds == true ? 'true' : 'false'}]`);
}

export async function estimateFeeTransfer(...amounts: string[]) {
    const amountsBN: bigint[] = await Promise.all(amounts.map(amount => this.account.humanToShielded(amount)));

    this.pause();
    const result: FeeAmount = await this.account.estimateFee(amountsBN, TxType.Transfer, false);
    this.resume();

    const effectiveAmount = amountsBN.reduce((acc, cur) => acc + cur, BigInt(0));

    this.echo(`Total fee est.:     [[;white;]${await this.account.shieldedToHuman(result.total)} ${this.account.shTokenSymbol()}]`);
    this.echo(`Fee components:     [[;white;](${await this.account.shieldedToHuman(result.relayerFee.fee)} per tx + ${await this.account.shieldedToHuman(result.relayerFee.oneByteFee)} per byte) ${this.account.tokenSymbol()}]`);
    this.echo(`Total calldata len: [[;white;]${result.calldataTotalLength} bytes]`);
    this.echo(`Transaction count:  [[;white;]${result.txCnt}`);
    this.echo(`Requested amount:   [[;white;]${await this.account.shieldedToHuman(effectiveAmount)} ${this.account.shTokenSymbol()}]`);
    this.echo(`Insuffic. balance:  [[;white;]${result.insufficientFunds == true ? 'true' : 'false'}]`);
}

export async function estimateFeeWithdraw(amount: string) {
    this.pause();
    const result: FeeAmount = await this.account.estimateFee([await this.account.humanToShielded(amount)], TxType.Withdraw, false);
    this.resume();

    this.echo(`Total fee est.:     [[;white;]${await this.account.shieldedToHuman(result.total)} ${this.account.shTokenSymbol()}]`);
    this.echo(`Fee components:     [[;white;](${await this.account.shieldedToHuman(result.relayerFee.fee)} per tx + ${await this.account.shieldedToHuman(result.relayerFee.oneByteFee)} per byte) ${this.account.tokenSymbol()}]`);
    this.echo(`Total calldata len: [[;white;]${result.calldataTotalLength} bytes]`);
    this.echo(`Transaction count:  [[;white;]${result.txCnt}]`);
    this.echo(`Insuffic. balance:  [[;white;]${result.insufficientFunds == true ? 'true' : 'false'}]`);
}

export async function getLimits(address: string | undefined) {
    this.pause();
    const result: PoolLimits = await this.account.getLimits(address);
    this.resume();

    this.echo(`[[;white;]Max available deposit:  ${await this.account.shieldedToHuman(result.deposit.total)} ${this.account.shTokenSymbol()}]`);
    this.echo(`[[;gray;]...single operation:    ${await this.account.shieldedToHuman(result.deposit.components.singleOperation)} ${this.account.shTokenSymbol()}]`);
    this.echo(`[[;gray;]...address daily limit: ${await this.account.shieldedToHuman(result.deposit.components.dailyForAddress.available)} / ${await this.account.shieldedToHuman(result.deposit.components.dailyForAddress.total)} ${this.account.shTokenSymbol()}]`);
    this.echo(`[[;gray;]...total daily limit:   ${await this.account.shieldedToHuman(result.deposit.components.dailyForAll.available)} / ${await this.account.shieldedToHuman(result.deposit.components.dailyForAll.total)} ${this.account.shTokenSymbol()}]`);
    this.echo(`[[;gray;]...pool limit:          ${await this.account.shieldedToHuman(result.deposit.components.poolLimit.available)} / ${await this.account.shieldedToHuman(result.deposit.components.poolLimit.total)} ${this.account.shTokenSymbol()}]`);
    this.echo(`[[;white;]Max available withdraw: ${await this.account.shieldedToHuman(result.withdraw.total)} ${this.account.shTokenSymbol()}]`);
    this.echo(`[[;gray;]...total daily limit:   ${await this.account.shieldedToHuman(result.withdraw.components.dailyForAll.available)} / ${await this.account.shieldedToHuman(result.withdraw.components.dailyForAll.total)} ${this.account.shTokenSymbol()}]`);
    this.echo(`[[;white;]Limits tier: ${result.tier}`);

}

export async function getMaxAvailableTransfer() {
    this.pause();
    const maxTransfer = await this.account.getMaxAvailableTransfer(TxType.Transfer);
    const humanTransfer = await this.account.shieldedToHuman(maxTransfer);
    const weiTransfer = await this.account.shieldedToWei(maxTransfer);
    const maxWithdraw = await this.account.getMaxAvailableTransfer(TxType.Withdraw);
    const humanWithdraw = await this.account.shieldedToHuman(maxWithdraw);
    const weiWithdraw = await this.account.shieldedToWei(maxWithdraw);
    this.resume();

    this.echo(`Max available shielded balance for:`);
    this.echo(`    ...transfer: [[;white;]${humanTransfer} ${this.account.shTokenSymbol()}] (${weiTransfer} wei)`);
    this.echo(`    ...withdraw: [[;white;]${humanWithdraw} ${this.account.shTokenSymbol()}] (${weiWithdraw} wei)`);
}

export async function depositShielded(amount: string, times: string) {
    let txCnt = times !== undefined ? Number(times) : 1;

    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
        this.echo(`Performing shielded deposit [${this.account.depositScheme()} scheme]${cntStr}...`);
        this.pause();

        // Due to the fact that the console is a test tool, we doesn't check address balance here
        // we should get ability to test relayer's behaviour
        const result = await this.account.depositShielded(await this.account.humanToShielded(amount));

        this.resume();
        this.echo(`Done [job #${result.jobId}]: [[!;;;;${this.account.getTransactionUrl(result.txHash)}]${result.txHash}]`);
    }
}

export async function depositShieldedEphemeral(amount: string, index: string) {
    let ephemeralIndex = index !== undefined ? Number(index) : 0;

    this.echo(`Getting ephemeral account info...`);
    this.pause();
    let ephemeralAddress = await this.account.getEphemeralAddress(ephemeralIndex);
    this.update(-1, `Ephemeral address [[!;;;;${this.account.getAddressUrl(ephemeralAddress.address)}]${ephemeralAddress.address}] has [[;white;]${await this.account.shieldedToHuman(ephemeralAddress.tokenBalance)}] ${this.account.tokenSymbol()}`);

    // Ephemeral account balance will be checked inside a library sinse its resposibility for ephemeral pool
    this.echo(`Performing shielded deposit from ephemeral address [[;white;]#${ephemeralIndex}] [${this.account.depositScheme()} scheme]...`);
    const result = await this.account.depositShieldedEphemeral(await this.account.humanToShielded(amount), ephemeralIndex);
    this.resume();
    this.echo(`Done [job #${result.jobId}]: [[!;;;;${this.account.getTransactionUrl(result.txHash)}]${result.txHash}]`);
}

export async function directDeposit(amount: string, times: string) {
    let txCnt = times !== undefined ? Number(times) : 1;
    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : '';
        this.echo(`Performing direct deposit${cntStr}...`);
        this.pause();
        const txHash = await this.account.directDeposit(await this.account.humanToShielded(amount));
        this.resume();
        this.echo(`Done: [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
    }
}

export async function directDepositNative(amount: string, times: string) {
    const curPool = await this.account.getCurrentPool();
    const poolEnv = env.pools[curPool];
    if (!poolEnv.isNative) {
        this.error(`The current pool (${curPool}) doesn't support native direct deposits`);
        return;
    }

    let txCnt = times !== undefined ? Number(times) : 1;
    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : '';
        this.echo(`Performing native direct deposit${cntStr}...`);
        this.pause();
        const txHash = await this.account.directDeposit(
            await this.account.humanToShielded(amount),
            DirectDepositType.Native
        );
        this.resume();
        this.echo(`Done: [[!;;;;${this.account.getTransactionUrl(txHash)}]${txHash}]`);
    }
}

export async function transferShielded(to: string, amount: string, times: string) {
    if ((await this.account.verifyShieldedAddress(to)) === false) {
        this.error(`Shielded address ${to} is invalid. Please check it!`);
    } else {
        let txCnt = 1;
        let requests: TransferRequest[] = [];
        requests.push({ destination: to, amountGwei: await this.account.humanToShielded(amount)});

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
                    newAmount = await this.account.humanToShielded(components[1]);
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
            requests.push({ destination: to, amountGwei: await this.account.humanToShielded(amount)});
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
    const withdrawAmount = await this.account.humanToShielded(amount);

    let swapAmount = 0;
    const supportedSwap = await this.account.maxSwapAmount();
    const supportedSwapWei = await this.account.shieldedToWei(supportedSwap)
    if (supportedSwapWei > 0) {
        const str = supportedSwapWei > (10n ** 24n) ? '>1M' : `up to ${await this.account.weiToHuman(supportedSwapWei)}`;
        this.echo(`[[;green;]You can swap few tokens (${str} ${this.account.tokenSymbol()}) into the native ones ${txCnt > 1 ? '(will applied to the each tx)' : ''}]`);
        this.resume();
        const val = await this.read('Specify amount to swap or press ENTER to skip: ');
        swapAmount = await this.account.humanToShielded(val ?? '0');
    }

    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
        this.echo(`Performing shielded withdraw${cntStr}...`);
        this.pause();
        const result = await this.account.withdrawShielded(withdrawAmount, address, swapAmount);
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
        this.error(`Cannot retrieve local root at index ${idx!.toString()}: ${err}`);
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
    this.echo(`  Address:            [[!;;;;${this.account.getAddressUrl(addr.address)}]${addr.address}]`);
    this.echo(`  Token balance:      [[;white;]${await this.account.shieldedToHuman(addr.tokenBalance)} ${this.account.tokenSymbol()}]`);
    this.echo(`  Native balance:     [[;white;]${await this.account.ethWeiToHuman(addr.nativeBalance)} ${this.account.nativeSymbol()}]`);
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
        this.echo(`  Address:            [[!;;;;${this.account.getAddressUrl(addr.address)}]${addr.address}]`);
        this.echo(`  Token balance:      [[;white;]${await this.account.shieldedToHuman(addr.tokenBalance)} ${this.account.tokenSymbol()}]`);
        this.echo(`  Native balance:     [[;white;]${await this.account.ethWeiToHuman(addr.nativeBalance)} ${this.account.nativeSymbol()}]`);
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
    this.echo(`Prover mode: ${await this.account.getProverMode()}`);
    this.resume();
}

export async function getProverInfo() {
    this.pause();
    const proverMode = await this.account.getProverMode();
    const delegatedProverUrls: string[] = this.account.getDelegatedProverUrls();
    switch(proverMode) {
        case ProverMode.Local:
            this.echo(`Local Prover`);
            break;
        case ProverMode.Delegated:
            if (delegatedProverUrls.length > 0) {
                this.echo(`Delegated Prover: ${delegatedProverUrls.join(', ')}`);
            } else {
                this.echo(`Delegated Prover: delegated prover url not provided`);
            }
            break;
        case ProverMode.DelegatedWithFallback:
            if (delegatedProverUrls.length > 0) {
                this.echo(`Delegated Prover with fallback: ${delegatedProverUrls.join(', ')}`);
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

    const shTokenSymb = await this.account.shTokenSymbol();

    for (const tx of history) {
        this.echo(`${await humanReadable(tx, this.account)} [[!;;;;${this.account.getTransactionUrl(tx.txHash)}]${tx.txHash}]`);

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
                this.echo(`                                  ${await this.account.shieldedToHuman(value.amount)} ${shTokenSymb} ${prep} ${destDescr}`);
            }
        }
        //this.echo(`RECORD ${tx.type} [[!;;;;${this.account.getTransactionUrl(tx.txHash)}]${tx.txHash}]`);
    }
}

async function humanReadable(record: HistoryRecord, account: Account): Promise<string> {
    let dt = new Date(record.timestamp * 1000);

    //tokenSymb: string, shTokenSymb: string

    let mainPart: string;
    let statusMark = ``;
    if (record.state == HistoryRecordState.Pending) {
        statusMark = `⌛ `;
    } else if (record.state == HistoryRecordState.RejectedByPool || record.state == HistoryRecordState.RejectedByRelayer) {
        statusMark = `❌ `;
    }

    const tokenSymb = await account.tokenSymbol();
    const shTokenSymb = await account.shTokenSymbol();

    if (record.actions.length > 0) {
        const totalAmount = record.actions.map(({ amount }) => amount).reduce((acc, cur) => acc + cur);
        const totalAmountStr = await account.shieldedToHuman(totalAmount);

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
            mainPart = `${statusMark}DEPOSITED  ${totalAmountStr} ${tokenSymb} FROM ${record.actions[0].from}`;      
        } else if (record.type == HistoryTransactionType.TransferIn) {
            mainPart = `${statusMark}RECEIVED   ${totalAmountStr} ${shTokenSymb} ${record.actions.length > 1 ? 'IN' : 'ON'} ${toAddress}`;
        } else if (record.type == HistoryTransactionType.TransferOut) {
            mainPart = `${statusMark}SENT       ${totalAmountStr} ${shTokenSymb} ${record.actions.length > 1 ? 'IN' : 'TO'} ${toAddress}`;
        } else if (record.type == HistoryTransactionType.Withdrawal) {
            mainPart = `${statusMark}WITHDRAWN  ${totalAmountStr} ${shTokenSymb} TO ${toAddress}`;
        } else if (record.type == HistoryTransactionType.DirectDeposit) {
            mainPart = `${statusMark}DEPOSITED DIRECT ${totalAmountStr} ${shTokenSymb} ${record.actions.length > 1 ? 'IN' : 'ON'} ${toAddress}`;
        } else {
            mainPart = `${statusMark}UNKNOWN TRANSACTION TYPE (${record.type})`
        }

        if (record.fee > 0) {
            mainPart += `(fee = ${await account.shieldedToHuman(record.fee)})`;
        }
    } else if (record.type == HistoryTransactionType.AggregateNotes) {
        mainPart = `${statusMark}AGGREGATE NOTES`;
        if (record.fee > 0) {
            mainPart += `(fee = ${await account.shieldedToHuman(record.fee)})`;
        }
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

    for (const aRecord of report) {
        this.echo(`[[;white;]${await humanReadable(aRecord, this.account)}] [[!;;;;${this.account.getTransactionUrl(aRecord.txHash)}]${aRecord.txHash}]`);
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
    metadata.userId = this.account.accountId;
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
    zipFile.file(`report_${metadata.userId}_${dateStrForFilename(genDate)}.json`, JSON.stringify(exportReport, replacer, space));
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
    this.account.detachAccount();
    this.reset();
}

export function getAccountId() {
    this.pause();
    this.echo(`Current Account ID:  [[;white;]${this.account.accountId}]`);
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
    this.echo(`Client library  version: [[;white;]${await this.account.libraryVersion()}]`);
    this.echo(`Current relayer version: ...fetching...`);

    try {
        const ver = await this.account.relayerVersion();
        this.update(-1, `Current relayer version: [[;white;]${ver.ref} @ ${ver.commitHash}]`);
    } catch (err) {
        this.update(-1, `Current relayer version: [[;red;]${err.message}]`);
    }

    if (await this.account.getProverMode() != ProverMode.Local) {
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
    const cloudUrl = env.cloudApi[this.account.getCurrentPool()];
    console.log("cloudUrl = ", cloudUrl)

    const singleCardBalance = await this.account.humanToShielded(cardBalance)
    const requiredTotalSum = singleCardBalance * BigInt(quantity);
    await this.account.syncState();
    const txRequests = Array(Number(quantity)).fill(singleCardBalance);
    const fee = await this.account.estimateFee(txRequests, TxType.Transfer, true);
    if (fee.insufficientFunds) {
        const [balance] = await this.account.getShieldedBalances(false); // state already updated, do not sync again
        const requiredStr = `${await this.account.shieldedToHuman(requiredTotalSum)} ${this.account.shTokenSymbol()}`;
        const feeStr = `${await this.account.shieldedToHuman(fee.total)} ${this.account.shTokenSymbol()}`;
        const balanceStr = `${await this.account.shieldedToHuman(balance)} ${this.account.shTokenSymbol()}`;
        this.echo(`[[;red;]Total card balance ${requiredStr} with required fee (${feeStr}) exceeds available funds (${balanceStr})]`);
        return;
    }
    const minTransferAmount = await this.account.minTxAmount();

    if (singleCardBalance < minTransferAmount) {
        const singleStr = `${await this.account.shieldedToHuman(singleCardBalance)} ${this.account.shTokenSymbol()}`;
        const minAmountStr = `${await this.account.shieldedToHuman(minTransferAmount)} ${this.account.shTokenSymbol()}`;
        this.echo(`[[;red;]Single card balance ${singleStr} less than minimum transfer amount ${minAmountStr}]`);
        return
    }

    const headers = new Headers();
    headers.append("Authorization", `Bearer ${authToken}`);
    headers.append("Content-Type", "application/json");
    let giftCards: GiftCard[] = [];
    const birthIndex = Number((await this.account.getPoolTreeState()).index);
    try {
        this.echo(`Generating account${Number(quantity) > 1 ? 's' : ''}...`);
        const baseUrl = env.redemptionUrls[this.account.getCurrentPool()];
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

            const exportResponse = await fetch(`${cloudUrl}/export?id=${cloudId}`, { headers });

            if (!exportResponse.ok) throw new Error(`export failed ${exportResponse}`)

            const exportJson = await exportResponse.json();
            let sk = `0x${exportJson.sk}`;

            const generateAddressResponse = await fetch(`${cloudUrl}/generateAddress?id=${cloudId}`);

            if (!generateAddressResponse.ok) throw new Error(`generate address failed ${exportResponse}`);
            const generateAddressResponseJson = await generateAddressResponse.json();
            const address = generateAddressResponseJson.address;
            console.log(`generated new account with address: ${address} `);

            const giftCardProps: GiftCardProperties = {
                sk: hexToBuf(sk, 32),
                birthIndex,
                balance: singleCardBalance,
                poolAlias: this.account.getCurrentPool,
            };

            console.log("giftCardProps:", giftCardProps);

            const url = await redemptionUrl(giftCardProps, baseUrl, this.account);
            const svg = qrcode(url);
            giftCards.push(new GiftCard(alias, cloudId, sk, address, svg, url));
            if (Number(quantity) > 1) {
                this.update(-1, `Generating accounts...[${ Math.round((cardIndex + 1)*100/Number(quantity))}%]`);
            }
        }
        this.update(-1, `Generating account${Number(quantity) > 1 ? 's' : ''}...[[;green;]OK]`);

        let zipUrl = await makeZippedReport(giftCards);
        this.echo(`Cards generated, [[!;;;;${zipUrl}]this archive] contains QR codes and summary report.\nSending funds ...`);
        const transferRequests:TransferRequest[] = await Promise.all(giftCards.map(
            async giftCard =>  {return {
                destination: giftCard.address,
                amountGwei: await this.account.humanToShielded(cardBalance)
            }
        } ));
        const result = await this.account.transferShielded(transferRequests);

        this.echo(`Transfer is [[;green;]DONE]:\n\t${result.map((singleTxResult: { jobId: any; txHash: any; }) => {
            return `[job #${singleTxResult.jobId}]: [[!;;;;${this.account.getTransactionUrl(singleTxResult.txHash)}]${singleTxResult.txHash}]`
        }).join(`\n     `)}`);

    } catch (error) {
        this.echo(`Process failed with error: [[;red;]${error.message}]`);
    }

    this.resume();

}

async function redemptionUrl(giftCard: GiftCardProperties, baseUrl: string, account: Account): Promise<string> {
    const code = await account.codeForGiftCard(giftCard);
    return `${baseUrl}/?gift-code=${code}`;
}

async function extractGiftCard(codeOrUrl: string, account: Account): Promise<GiftCardProperties> {
    let giftCard: GiftCardProperties;
    try {
        giftCard = await account.giftCardFromCode(codeOrUrl)
        return giftCard;
    } catch (err) { }

    const url = new URL(codeOrUrl);
    const urlSearchParams = new URLSearchParams(url.search.slice(1));
    const code = urlSearchParams.get('gift-code');
    if (code) {
        return await account.giftCardFromCode(code);
    }

    throw new Error('Cannot extract correct gift card from provided code or redemption URL');
}

export function qrcode(data: string): string {
    const QRC = qrcodegen.QrCode;
    const qr0 = QRC.encodeText(data, QRC.Ecc.MEDIUM);
    const svg = toSvgString(qr0, 4, "#FFFFFF", "#000000");

    return svg
}


function asDownload(data) {
    return window.URL.createObjectURL(new Blob([data], { type: "text/plain" }));
}

async function makeZippedReport(giftCards: GiftCard[]) {
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

async function zipQrCodes(links: string[], account: Account): Promise<string> {
    let mainZip = new JSZip();
    const summary = await Promise.all(links.map(async (aLink, index) => {
        const giftCardProps = await extractGiftCard(aLink, account);
        const skHash = [...new Uint8Array(sha256(giftCardProps.sk))].map(x => x.toString(16).padStart(2, '0')).join('');
        const qrFileName = `gift-card-${giftCardProps.poolAlias}-${('0000' + index).slice(-4)}-${skHash.slice(-16)}.svg`;
        mainZip.file(qrFileName, qrcode(aLink));

        return { url: aLink, sk: '0x' + bufToHex(giftCardProps.sk), balance: giftCardProps.balance.toString(), svg: qrFileName };
    }));

    mainZip.file(`_summary.json`, JSON.stringify(summary, null, '\t'));

    let zipped = await mainZip.generateAsync({ type: 'blob' })
    let url = window.URL.createObjectURL(new Blob([zipped], { type: "application/zip" }));
    return url
}

export async function generateGiftCardLocal(amount: string, quantity: string){

    let qty = Number(quantity ?? 1);
    const cardBalance = await this.account.humanToShielded(amount);
    const poolAlias = this.account.getCurrentPool();

    this.pause();

    // check is account has enough funds to deposit gift-card
    this.echo('Checking available funds...');
    await this.account.syncState();
    const availableFunds = await this.account.getMaxAvailableTransfer(TxType.Transfer);
    if (availableFunds >= cardBalance * BigInt(qty) ) {
        this.update(-1, 'Checking available funds... [[;green;]OK]');

        let  transferRequests:TransferRequest[] = [];
        let walletUrls: string[] = [];
        this.echo(`Creating burner wallets... 0/${qty}`);
        const birthIndex = Number((await this.account.getPoolTreeState()).index);
        for (let index = 0; index < qty; index++) {
            const mnemonic = bip39.generateMnemonic();
            const sk = deriveSpendingKeyZkBob(mnemonic)
            const receivingAddress = await this.account.genShieldedAddressForSeed(sk)
            transferRequests.push( {
                    destination: receivingAddress,
                    amountGwei: cardBalance
                });
            this.update(-1,`Creating burner wallets... ${index+1}/${qty}`);
            const giftCardProps: GiftCardProperties = { sk, birthIndex, balance: cardBalance, poolAlias };
            const baseUrl = env.redemptionUrls[this.account.getCurrentPool()];
            const url = await redemptionUrl(giftCardProps, baseUrl, this.account);
            walletUrls.push(url);
        }
        const urlsJoined = walletUrls.join("\n");
        this.update(-1, `Your gift cards URL${walletUrls.length > 1 ? 's' : ''}:\n${urlsJoined}`);
        const qrUrl = await zipQrCodes(walletUrls, this.account);
        this.echo (`[[;red;]DON'T FORGET TO COPY THE LINK${walletUrls.length > 1 ? 'S' : ''} ABOVE OR DOWNLOAD AN] [[!;;;;${qrUrl}]QR ARCHIVE]`);
        if (qty > 1) {
            let entered: string;
            this.echo (`[[;yellow;]Please keep in mind you'll lost your money in case of loosing links and QRs]`);
            this.resume();
            do {
                entered = await this.read(`[[;yellow;]Type 'YES' to confirm links\\QRs are saved and valid or 'NO' to cancel: ]`)
                if (entered.toLowerCase() == 'no') {
                    this.echo(`Gift cards generating has been cancelled. Each of them has zero balance. Please try again`);
                    return;
                }
            }while(entered.toLowerCase() != 'yes');
        } else if (qty == 1) {
            this.echo('<div style = \"width:25%\"id=\"qr\"></div>', {
                raw: true,
                finalize: function(div) {
                    div.find('#qr').html(removeSvgHeader(qrcode(walletUrls[0])));
                }
            });
        }

        this.pause();
        this.echo('Sending funds...');
        const results = await this.account.transferShielded(transferRequests);
        this.update(-1 , `Sending funds... [[;green;]OK] ${results.map((singleResult) => {
            return `[job #${singleResult.jobId}]: [[!;;;;${this.account.getTransactionUrl(singleResult.txHash)}]${singleResult.txHash}]`
        }).join(`\n     `)}`);
    } else {
        this.update(-1, 'Checking available funds... [[;red;]NOT ENOUGH FUNDS]');
    }

    this.resume();
}


function removeSvgHeader(data: string) {
    let header = `<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"`
    return data.replace(header,'')
}

export async function giftCardBalance(...codeOrUrls: string[]) {
    this.pause();
    if (codeOrUrls.length > 1) {
        this.echo(`Checking balance of ${codeOrUrls.length} gift cards...`);
    }

    let redeemedCnt = 0;
    let cardsBalance = 0n;
    for (let codeOrUrl of codeOrUrls) {
        const giftCard = await extractGiftCard(codeOrUrl, this.account);

        this.echo(`Gift card properties:${codeOrUrls.length > 1 ? `\t\/\/ ${codeOrUrl}` : '' }`);
        this.echo(`  sk:       [[;white;]${bufToHex(giftCard.sk)}]`);
        this.echo(`  birthIdx: [[;white;]${giftCard.birthIndex}]`);
        this.echo(`  balance:  [[;white;]${await this.account.shieldedToHuman(giftCard.balance)} BOB]`);
        this.echo(`  pool:     [[;white;]${giftCard.poolAlias}]`);

        this.echo(`Getting actual gift card balance...`);
        const balance = await this.account.giftCardBalance(giftCard);
        this.update(-1, `Actual gift card balance: [[;white;]${await this.account.shieldedToHuman(balance)} ${this.account.shTokenSymbol()}]`)

        redeemedCnt += (balance == 0n ? 1 : 0);
        cardsBalance += balance;
    }

    if (codeOrUrls.length > 1) {
        const redeemedCntStr = redeemedCnt > 0 ? 
            `Found [[;white;]${redeemedCnt}] redeemed card${redeemedCnt > 1 ? 's' : ''}` :
            'There are no redeemed cards';
        this.echo(`\nTotal checked [[;white;]${codeOrUrls.length}] cards. ${redeemedCntStr}`);
        this.echo(`Total cards balance: [[;white;]${await this.account.shieldedToHuman(cardsBalance)} BOB]\n`);
    }

    this.resume();
}

export async function redeemGiftCard(codeOrUrl: string) {
    const giftCard = await extractGiftCard(codeOrUrl, this.account);

    this.echo(`Gift card properties:`);
    this.echo(`  sk:       [[;white;]${bufToHex(giftCard.sk)}]`);
    this.echo(`  birthIdx: [[;white;]${giftCard.birthIndex}]`);
    this.echo(`  balance:  [[;white;]${await this.account.shieldedToHuman(giftCard.balance)} BOB]`);
    this.echo(`  pool:     [[;white;]${giftCard.poolAlias}]`);

    this.pause();
    this.echo(`Redeeming gift card...`);
    const result = await this.account.redeemGiftCard(giftCard);
    this.echo(`Done [job #${result.jobId}]: [[!;;;;${this.account.getTransactionUrl(result.txHash)}]${result.txHash}]`);
    this.resume();
}
