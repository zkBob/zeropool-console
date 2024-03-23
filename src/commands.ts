import bip39 from 'bip39-light';
import { EphemeralAddress, HistoryRecord, HistoryTransactionType, ComplianceHistoryRecord, PoolLimits, TxType,
         TransferConfig, TransferRequest, TreeState, ProverMode, HistoryRecordState, GiftCardProperties, FeeAmount,
         deriveSpendingKeyZkBob,
         DepositType, DirectDepositType, DirectDeposit, ClientState, CommittedForcedExit, ForcedExitState, ProxyFee,
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

function account(_this: any): Account {
    return _this.account;
}

export async function currentPoolEnvironment() {
    const curPool = account(this).getCurrentPool();
    const poolEnv = env.pools[curPool];
    const chainEnv = env.chains[String(poolEnv.chainId)];

    this.echo(`Current pool: ${curPool}`);
    this.echo(`Chain:        ${account(this).networkName()} (${poolEnv.chainId})`)
    this.echo(`Pool address:     [[!;;;;${account(this).getAddressUrl(poolEnv.poolAddress)}]${poolEnv.poolAddress}]`);
    this.echo(`Token address:    [[!;;;;${account(this).getAddressUrl(poolEnv.tokenAddress)}]${poolEnv.tokenAddress}]`);
    this.echo(`RPC endpoint${chainEnv.rpcUrls.length > 1 ? 's' : ' '}:    ${chainEnv.rpcUrls.join(', ')}`);
    if (poolEnv.relayerUrls && poolEnv.relayerUrls.length > 0) {
        this.echo(`Relayer${poolEnv.relayerUrls.length > 1 ? 's' : ' '}:         ${poolEnv.relayerUrls.join(', ')}`);
    }
    if (poolEnv.proxyUrls && poolEnv.proxyUrls.length > 0) {
        this.echo(`${poolEnv.proxyUrls.length > 1 ? 'Proxies' : 'Proxy  '}:          ${poolEnv.proxyUrls.join(', ')}`);
    }
    this.echo(`Cold storage:     ${poolEnv.coldStorageConfigPath}`);
    if (poolEnv.delegatedProverUrls && poolEnv.delegatedProverUrls.length > 0) {
        this.echo(`Delegated prover${poolEnv.delegatedProverUrls.length > 1 ? 's' : ''}: ${poolEnv.delegatedProverUrls.join(', ')}`);
    }
    this.echo(`Minter:           ${env.minters[curPool]}`);
    this.echo(`Cloud API:        ${env.cloudApi[curPool]}`);
    this.echo(`UI URL:           ${env.redemptionUrls[curPool]}`);
}

export async function getAvailablePools() {
    const pools: string[] = await account(this).getPools();
    this.echo(`Available pools: ${pools.join(', ')}`);
}

export async function switchPool(poolAlias: string, password: string) {
    if (!poolAlias) {
        const pools: string[] = await account(this).getPools();
        this.echo(`[[;red;]Please provide a pool alias. Currently supported: ${pools.join(', ')}]`)
        return;
    }
    if (!password) {
        this.set_mask(true);
        password = (await this.read('Enter account password to switch L1 client: ')).trim();
        this.set_mask(false);
    }


    this.pause();
    await account(this).switchPool(poolAlias, password);
    this.resume();
    this.echo(`Current pool: ${await account(this).getCurrentPool()}`);
}

export async function getSeed(password: string) {
    if (!password) {
        this.set_mask(true);
        password = (await this.read('Enter account password: ')).trim();
        this.set_mask(false);
    }

    const seed = account(this).getSeed(account(this).accountName, password);
    this.echo(`[[;gray;]Seed phrase: ${seed}]`);
}

export async function getSk(password: string) {
    if (!password) {
        this.set_mask(true);
        password = (await this.read('Enter account password: ')).trim();
        this.set_mask(false);
    }

    const seed = account(this).getSeed(account(this).accountName, password);
    const sk = deriveSpendingKeyZkBob(seed);
    this.echo(`[[;gray;]Spending key: 0x${bufToHex(sk)}]`);
}

export async function getAddress() {
    const address = await account(this).getRegularAddress();
    this.echo(`[[;gray;]Address:] [[!;;;;${account(this).getAddressUrl(address)}]${address}]`);
}

export async function genShieldedAddress(number: string) {
    let addressNum = number !== undefined ? Number(number) : 1;
    this.pause();
    for (let i = 0; i < addressNum; i++) {
        const address = await account(this).genShieldedAddress();
        this.echo(`[[;gray;]${address}]`);
    }
    this.resume();
}

export async function genShieldedAddressUniversal(number: string) {
    let addressNum = number !== undefined ? Number(number) : 1;
    this.pause();
    for (let i = 0; i < addressNum; i++) {
        const address = await account(this).genShieldedAddressUniversal();
        this.echo(`[[;gray;]${address}]`);
    }
    this.resume();
}

export async function shieldedAddressInfo(shieldedAddress: string) {
    this.echo('Validating ...');
    const isValid = await account(this).verifyShieldedAddress(shieldedAddress);
    this.update(-1, `Validating ${isValid ? '[[;green;]PASS]' : '[[;red;]ERROR]'}`)
    this.echo('Checking ownable on the current pool ...');
    const isOwn = await account(this).isMyAddress(shieldedAddress);
    this.update(-1, `Checking ownable on the current pool ${isOwn ? '[[;green;]YES]' : '[[;red;]NO]'}`)

    this.echo('Parsing address...');
    try {
        const components = await account(this).zkAddressInfo(shieldedAddress);
        this.update(-1, 'Parsing address... [[;green;]OK]');
        this.echo(`Address format:    [[;white;]${components.format}]`);
        this.echo(`Is it derived from my SK:    ${components.derived_from_our_sk ? '[[;green;]YES]' : '[[;white;]NO]'}`);
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
    const [balance, readable] = await account(this).getBalance();
    this.echo(`[[;gray;]Balance: [[;white;]${readable} ${account(this).nativeSymbol()}] (${balance} wei)]`);
}

export async function getShieldedBalance() {
    this.pause();
    const [total, acc, note] = await account(this).getShieldedBalances(true);    // update state only once
    const optimisticBalance = await account(this).getOptimisticTotalBalance(false);

    this.echo(`[[;gray;]
[[;white;]Private balance: ${await account(this).shieldedToHuman(total)} ${account(this).shTokenSymbol()}]
      - account: ${await account(this).shieldedToHuman(acc)} ${account(this).shTokenSymbol()} (${await account(this).shieldedToWei(acc)} wei)
      - note:    ${await account(this).shieldedToHuman(note)} ${account(this).shTokenSymbol()} (${await account(this).shieldedToWei(note)} wei)
]`);

    if (total != optimisticBalance) {
        this.echo(`[[;green;]Optimistic private balance: ${await account(this).shieldedToHuman(optimisticBalance)} ${account(this).shTokenSymbol()} (${await account(this).shieldedToWei(optimisticBalance)} wei)
]`);
    }

    this.resume();
}

export async function getTokenBalance() {
    const balanceWei = await account(this).getTokenBalance();
    const human = await account(this).weiToHuman(balanceWei);
    this.echo(`Token balance: [[;white;]${human} ${account(this).tokenSymbol()}] (${balanceWei} wei)`);
}

export async function getTokenAllowance(spender: string) {
    if (spender && account(this).validateNativeAddress(spender)) {
        this.pause();
        const tokenAddress = account(this).getTokenAddr();
        this.echo(`Checking [[!;;;;${account(this).getAddressUrl(tokenAddress)}]token] allowance for [[!;;;;${account(this).getAddressUrl(spender)}]${spender}]... `);
        const allowance = await account(this).getTokenAllowance(spender);
        if (allowance == 0n) {
            this.echo(`[[;red;]There are no approved tokens for the provided address]`);    
        } else {
            this.update(-1, `The spender can spend up to [[;white;]${await account(this).weiToHuman(allowance)} ${account(this).tokenSymbol()}]`);
        }
        this.resume();
    } else {
        this.echo(`[[;red;]Invalid address provided: ${spender}]`);
    }
}

export async function mint(amount: string) {
    this.pause();
    this.echo('Minting tokens... ');
    const txHash = await account(this).mint(await account(this).humanToWei(amount));
    this.update(-1, `Minting tokens... [[!;;;;${account(this).getTransactionUrl(txHash)}]${txHash}]`);
    this.resume();
}

export async function transfer(to: string, amount: string) {
    if (to && account(this).validateNativeAddress(to)) {
        this.pause();
        this.echo(`Transfering ${account(this).nativeSymbol()}... `);
        const txHash = await account(this).transfer(to, account(this).humanToEthWei(amount));
        this.update(-1, `Transfering ${account(this).nativeSymbol()}... [[!;;;;${account(this).getTransactionUrl(txHash)}]${txHash}]`);
        this.resume();
    } else {
        this.echo(`[[;red;]Invalid address provided: ${to}]`);
    }
}

export async function transferToken(to: string, amount: string) {
    if (to && account(this).validateNativeAddress(to)) {
        this.pause();
        this.echo(`Transfering ${account(this).tokenSymbol()}... `);
        const txHash = await account(this).transferToken(to, await account(this).humanToWei(amount));
        this.update(-1, `Transfering ${account(this).tokenSymbol()}... [[!;;;;${account(this).getTransactionUrl(txHash)}]${txHash}]`);
        this.resume();
    } else {
        this.echo(`[[;red;]Invalid address provided: ${to}]`);
    }
}

export async function approveToken(spender: string, amount: string) {
    if (spender && account(this).validateNativeAddress(spender)) {
        this.pause();
        this.echo(`Approving ${account(this).tokenSymbol()}... `);
        const txHash = await account(this).approveAllowance(spender, await account(this).humanToWei(amount));
        this.update(-1, `Approving ${account(this).tokenSymbol()}... [[!;;;;${account(this).getTransactionUrl(txHash)}]${txHash}]`);
        this.resume();
    } else {
        this.echo(`[[;red;]Invalid address provided: ${spender}]`);
    }
}

export async function getTxParts(...amounts: string[]) {
    const amountsBN: bigint[] = await Promise.all(amounts.map(amount => account(this).humanToShielded(amount)));

    let entered = '';
    let txType = TxType.Transfer;
    let swapAmount = 0n;
    this.echo(`[[;yellow;]Fee for transfer and withdraw transactions may vary]`)
    this.resume();
    do {
        entered = (await this.read('Please specify tx type ([t]ransfer(default) or [w]ithdraw): ')).toLowerCase();
        if (entered == 't' || entered == 'transfer') {
            txType = TxType.Transfer;
            break;
        } else if (entered == 'w' || entered == 'withdraw') {
            txType = TxType.Withdraw;

            do {
                entered = (await this.read('[[;yellow;]Do you want to swap withdrawn tokens to the native coins (yes or no(default))?] ')).toLowerCase();
                if (entered == 'y' || entered == 'yes') {
                    swapAmount = 1n;
                    break;
                } else if (entered == 'n' || entered == 'no') {
                    break;
                }
            } while(entered != '');

            break;
        }
    } while(entered != '');
    const txName = txType == TxType.Transfer ? 'transfer' : 'withdraw';
    
    this.pause();
    const result: TransferConfig[] = await account(this).getTxParts(txType, amountsBN, swapAmount);
    this.resume();

    if (amounts.length > 1) {
        const humanReadAmounts = await Promise.all(amountsBN.map(async a => `^${await account(this).shieldedToHuman(a)}`)); 
        this.echo(`Multi-destination request: ${humanReadAmounts.join(', ')}`);
    }

    if (result.length == 0) {
        this.echo(`Cannot create such ${txName} transaction (insufficient funds or amount too small)`);
    } else {
        let totalFee = BigInt(0);
        for (const part of result) {
            totalFee += part.fee.total;
        }

        if (result.length == 1) {
            this.echo(`You can ${txName} this amount within single transaction`);
        } else {
            this.echo(`Multitransfer detected. To ${txName} this amount will require ${result.length} txs`);
        }
        this.echo(`Fee required: ${await account(this).shieldedToHuman(totalFee)} ${account(this).shTokenSymbol()}`);
    }

    const multiTxColors = ['green', 'purple', 'yellow', 'aqua', 'olive', 'magenta', 'orange', 'pink', 'lime', 'salmon'];
    let lastDest = '';
    let curColorIdx = -1;

    for (let i = 0; i < result.length; i++) {
        const part = result[i];
        const notes = part.outNotes;
        const partFeeTotal = await account(this).shieldedToHuman(part.fee.total);
        const partFeeProxy = await account(this).shieldedToHuman(part.fee.proxyPart);
        const partFeeProver = await account(this).shieldedToHuman(part.fee.proverPart);
        let partLimit = "";
        if (part.accountLimit > 0) {
            partLimit = `, accountLimit = ${await account(this).shieldedToHuman(part.accountLimit)} ${account(this).shTokenSymbol()}`;
        }

        const txTotalAmount = notes.map(note => note.amountGwei).reduce((acc, cur) => acc + cur, BigInt(0));
        if (notes.length == 0) {
            this.echo(`TX#${i} Aggregate notes: ${await account(this).shieldedToHuman(part.inNotesBalance)} ${account(this).shTokenSymbol()} [fee: ${partFeeTotal} = ${partFeeProxy} + ${partFeeProver}]${partLimit}`);
        } else {
            if (amounts.length > 1 || notes.length > 1) {
                this.echo(`TX#${i} ${await account(this).shieldedToHuman(txTotalAmount)} ${account(this).shTokenSymbol()} [fee: ${partFeeTotal} = ${partFeeProxy} + ${partFeeProver}}]${partLimit}`);
                for (const aNote of notes) {
                    if(aNote.destination != lastDest) {
                        lastDest = aNote.destination;
                        curColorIdx = (curColorIdx + 1) % multiTxColors.length;
                    }
                    this.echo(`     [[;${multiTxColors[curColorIdx]};]${await account(this).shieldedToHuman(aNote.amountGwei)}] ${account(this).shTokenSymbol()} -> ${aNote.destination}`);
                }
            } else {
                const color = (notes.length == 0 ? 'gray' : 'green');
                this.echo(`TX#${i} [[;${color};]${await account(this).shieldedToHuman(txTotalAmount)}] ${account(this).shTokenSymbol()} [fee: ${partFeeTotal} = ${partFeeProxy} + ${partFeeProver}]${partLimit}`);
            }
        }
    }
}

export async function estimateFeeDeposit(amount: string) {
    this.pause();
    const txType = env.pools[account(this).getCurrentPool()].depositScheme == DepositType.Approve ? TxType.Deposit : TxType.BridgeDeposit;
    const result: FeeAmount = await account(this).estimateFee([await account(this).humanToShielded(amount ?? '0')], txType, 0n, false);
    this.resume();

    let perTx = '';
    let perByte = '';
    let proverFee = '';
    const baseFee = txType == TxType.Deposit ? result.sequencerFee.fee.deposit : result.sequencerFee.fee.permittableDeposit;
    if (baseFee > 0n) {
        perTx = `${await account(this).shieldedToHuman(baseFee)} per tx`
    }
    if (result.sequencerFee.oneByteFee > 0n) {
        perByte = `${await account(this).shieldedToHuman(result.sequencerFee.oneByteFee)} per byte`
    }
    const proxyFee = result.sequencerFee as ProxyFee
    if (proxyFee && proxyFee.proverFee > 0n) {
        proverFee = `${await account(this).shieldedToHuman(proxyFee.proverFee)} to prover`;
    }
    const components = [perTx, perByte, proverFee].filter((s) => s.length > 0);

    this.echo(`Total fee est.:     [[;white;]${await account(this).shieldedToHuman(result.fee.total)} ${account(this).tokenSymbol()}]`);
    this.echo(`Fee components:     [[;white;](${components.length > 0 ? components.join(' + ') : '--'}) ${account(this).tokenSymbol()}]`);
    this.echo(`Total calldata len: [[;white;]${result.calldataTotalLength} bytes]`);
    this.echo(`Transaction count:  [[;white;]${result.txCnt}]`);
    this.echo(`Insuffic. balance:  [[;white;]${result.insufficientFunds == true ? 'true' : 'false'}]`);
}

export async function estimateFeeTransfer(...amounts: string[]) {
    const amountsBN: bigint[] = await Promise.all(amounts.map(amount => account(this).humanToShielded(amount)));

    this.pause();
    const result: FeeAmount = await account(this).estimateFee(amountsBN, TxType.Transfer, 0n, false);
    this.resume();

    const effectiveAmount = amountsBN.reduce((acc, cur) => acc + cur, BigInt(0));

    let perTx = '';
    let perByte = '';
    let proverFee = '';
    if (result.sequencerFee.fee.transfer > 0n) {
        perTx = `${await account(this).shieldedToHuman(result.sequencerFee.fee.transfer)} per tx`
    }
    if (result.sequencerFee.oneByteFee > 0n) {
        perByte = `${await account(this).shieldedToHuman(result.sequencerFee.oneByteFee)} per byte`
    }
    const proxyFee = result.sequencerFee as ProxyFee
    if (proxyFee && proxyFee.proverFee > 0n) {
        proverFee = `${await account(this).shieldedToHuman(proxyFee.proverFee)} to prover`;
    }
    const components = [perTx, perByte, proverFee].filter((s) => s.length > 0);

    this.echo(`Total fee est.:     [[;white;]${await account(this).shieldedToHuman(result.fee.total)} ${account(this).shTokenSymbol()}]`);
    this.echo(`Fee components:     [[;white;](${components.length > 0 ? components.join(' + ') : '--'}) ${account(this).tokenSymbol()}]`);
    this.echo(`Total calldata len: [[;white;]${result.calldataTotalLength} bytes]`);
    this.echo(`Transaction count:  [[;white;]${result.txCnt}`);
    this.echo(`Requested amount:   [[;white;]${await account(this).shieldedToHuman(effectiveAmount)} ${account(this).shTokenSymbol()}]`);
    this.echo(`Insuffic. balance:  [[;white;]${result.insufficientFunds == true ? 'true' : 'false'}]`);
}

export async function estimateFeeWithdraw(amount: string) {
    const amountSh = await account(this).humanToShielded(amount);

    this.resume();
    let swapAmount = 0n;
    let entered = '';
    do {
        entered = (await this.read('[[;yellow;]Do you want to swap withdrawn tokens to the native coins (yes or no(default))?] ')).toLowerCase();
        if (entered == 'y' || entered == 'yes') {
            swapAmount = 1n;
            break;
        } else if (entered == 'n' || entered == 'no') {
            break;
        }
    } while(entered != '');

    this.pause();
    const result: FeeAmount = await account(this).estimateFee([amountSh], TxType.Withdraw, swapAmount, false);
    this.resume();

    let perTx = '';
    let perByte = '';
    let swapFee = '';
    let proverFee = '';
    if (result.sequencerFee.fee.withdrawal > 0n) {
        perTx = `${await account(this).shieldedToHuman(result.sequencerFee.fee.withdrawal)} per tx`
    }
    if (result.sequencerFee.oneByteFee > 0n) {
        perByte = `${await account(this).shieldedToHuman(result.sequencerFee.oneByteFee)} per byte`
    }
    if (result.sequencerFee.nativeConvertFee > 0n && swapAmount > 0n) {
        swapFee = `${await account(this).shieldedToHuman(result.sequencerFee.nativeConvertFee)} swap`;
    }
    const proxyFee = result.sequencerFee as ProxyFee
    if (proxyFee && proxyFee.proverFee > 0n) {
        proverFee = `${await account(this).shieldedToHuman(proxyFee.proverFee)} to prover`;
    }
    const components = [perTx, perByte, swapFee, proverFee].filter((s) => s.length > 0);

    this.echo(`Total fee est.:     [[;white;]${await account(this).shieldedToHuman(result.fee.total)} ${account(this).shTokenSymbol()}]`);
    this.echo(`Fee components:     [[;white;](${components.length > 0 ? components.join(' + ') : '--'}) ${account(this).tokenSymbol()}]`);
    this.echo(`Total calldata len: [[;white;]${result.calldataTotalLength} bytes]`);
    this.echo(`Transaction count:  [[;white;]${result.txCnt}]`);
    this.echo(`Insuffic. balance:  [[;white;]${result.insufficientFunds == true ? 'true' : 'false'}]`);
}

export async function getLimits(address: string | undefined) {
    this.pause();
    const result: PoolLimits = await account(this).getLimits(address);
    this.resume();

    this.echo(`[[;white;]Max available deposit:  ${await account(this).shieldedToHuman(result.deposit.total)} ${account(this).shTokenSymbol()}]`);
    this.echo(`[[;gray;]...single operation:    ${await account(this).shieldedToHuman(result.deposit.components.singleOperation)} ${account(this).shTokenSymbol()}]`);
    this.echo(`[[;gray;]...address daily limit: ${await account(this).shieldedToHuman(result.deposit.components.dailyForAddress.available)} / ${await account(this).shieldedToHuman(result.deposit.components.dailyForAddress.total)} ${account(this).shTokenSymbol()}]`);
    this.echo(`[[;gray;]...total daily limit:   ${await account(this).shieldedToHuman(result.deposit.components.dailyForAll.available)} / ${await account(this).shieldedToHuman(result.deposit.components.dailyForAll.total)} ${account(this).shTokenSymbol()}]`);
    this.echo(`[[;gray;]...pool limit:          ${await account(this).shieldedToHuman(result.deposit.components.poolLimit.available)} / ${await account(this).shieldedToHuman(result.deposit.components.poolLimit.total)} ${account(this).shTokenSymbol()}]`);
    this.echo(`[[;white;]Max available withdraw: ${await account(this).shieldedToHuman(result.withdraw.total)} ${account(this).shTokenSymbol()}]`);
    this.echo(`[[;gray;]...total daily limit:   ${await account(this).shieldedToHuman(result.withdraw.components.dailyForAll.available)} / ${await account(this).shieldedToHuman(result.withdraw.components.dailyForAll.total)} ${account(this).shTokenSymbol()}]`);
    this.echo(`[[;white;]Max available DD:       ${await account(this).shieldedToHuman(result.dd.total)} ${account(this).shTokenSymbol()}]`);
    this.echo(`[[;gray;]...single operation:    ${await account(this).shieldedToHuman(result.dd.components.singleOperation)} ${account(this).shTokenSymbol()}]`);
    this.echo(`[[;gray;]...address daily limit: ${await account(this).shieldedToHuman(result.dd.components.dailyForAddress.available)} / ${await account(this).shieldedToHuman(result.dd.components.dailyForAddress.total)} ${account(this).shTokenSymbol()}]`);
    this.echo(`[[;white;]Limits tier: ${result.tier}`);

}

export async function getMaxAvailableTransfer() {
    this.pause();
    const maxTransfer = await account(this).getMaxAvailableTransfer(TxType.Transfer);
    const humanTransfer = await account(this).shieldedToHuman(maxTransfer);
    const weiTransfer = await account(this).shieldedToWei(maxTransfer);
    const maxWithdraw = await account(this).getMaxAvailableTransfer(TxType.Withdraw);
    const humanWithdraw = await account(this).shieldedToHuman(maxWithdraw);
    const weiWithdraw = await account(this).shieldedToWei(maxWithdraw);
    const maxWithdrawSwap = await account(this).getMaxAvailableTransfer(TxType.Withdraw, 1n);
    const humanWithdrawSwap = await account(this).shieldedToHuman(maxWithdrawSwap);
    const weiWithdrawSwap = await account(this).shieldedToWei(maxWithdrawSwap);
    this.resume();

    this.echo(`Max available shielded balance for:`);
    this.echo(`    ...transfer:      [[;white;]${humanTransfer} ${account(this).shTokenSymbol()}] (${weiTransfer} wei)`);
    this.echo(`    ...withdraw:      [[;white;]${humanWithdraw} ${account(this).shTokenSymbol()}] (${weiWithdraw} wei)`);
    this.echo(`    ...withdraw+swap: [[;white;]${humanWithdrawSwap} ${account(this).shTokenSymbol()}] (${weiWithdrawSwap} wei)`);
}

export async function depositShielded(amount: string, times: string) {
    let txCnt = times !== undefined ? Number(times) : 1;

    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
        this.echo(`Performing shielded deposit [${account(this).depositScheme()} scheme]${cntStr}...`);
        this.pause();

        // Due to the fact that the console is a test tool, we doesn't check address balance here
        // we should get ability to test sequencer's behaviour
        const result = await account(this).depositShielded(await account(this).humanToShielded(amount));

        this.resume();
        if (result.txHash) {
            this.echo(`Done [job #${result.jobId}]: [[!;;;;${account(this).getTransactionUrl(result.txHash)}]${result.txHash}]`);
        } else {
            this.echo(`Done [job #${result.jobId}]: [[;red;]tx hash was not provided]`);
        }
    }
}

export async function depositShieldedEphemeral(amount: string, index: string) {
    let ephemeralIndex = index !== undefined ? Number(index) : 0;

    this.echo(`Getting ephemeral account info...`);
    this.pause();
    let ephemeralAddress = await account(this).getEphemeralAddress(ephemeralIndex);
    this.update(-1, `Ephemeral address [[!;;;;${account(this).getAddressUrl(ephemeralAddress.address)}]${ephemeralAddress.address}] has [[;white;]${await account(this).shieldedToHuman(ephemeralAddress.tokenBalance)}] ${account(this).tokenSymbol()}`);

    // Ephemeral account balance will be checked inside a library sinse its resposibility for ephemeral pool
    this.echo(`Performing shielded deposit from ephemeral address [[;white;]#${ephemeralIndex}] [${account(this).depositScheme()} scheme]...`);
    const result = await account(this).depositShieldedEphemeral(await account(this).humanToShielded(amount), ephemeralIndex);
    this.resume();
    if (result.txHash) {
        this.echo(`Done [job #${result.jobId}]: [[!;;;;${account(this).getTransactionUrl(result.txHash)}]${result.txHash}]`);
    } else {
        this.echo(`Done [job #${result.jobId}]: [[;red;]tx hash was not provided]`);
    }
}

export async function directDeposit(amount: string, times: string) {
    let txCnt = times !== undefined ? Number(times) : 1;
    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : '';
        this.echo(`Performing direct deposit${cntStr}...`);
        this.pause();
        const txHash = await account(this).directDeposit(await account(this).humanToShielded(amount));
        this.resume();
        this.echo(`Done: [[!;;;;${account(this).getTransactionUrl(txHash)}]${txHash}]`);
    }
}

export async function directDepositNative(amount: string, times: string) {
    const curPool = await account(this).getCurrentPool();
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
        const txHash = await account(this).directDeposit(
            await account(this).humanToShielded(amount),
            DirectDepositType.Native
        );
        this.resume();
        this.echo(`Done: [[!;;;;${account(this).getTransactionUrl(txHash)}]${txHash}]`);
    }
}

export async function transferShielded(to: string, amount: string, times: string) {
    if ((await account(this).verifyShieldedAddress(to)) === false) {
        this.error(`Shielded address ${to} is invalid. Please check it!`);
    } else {
        let txCnt = 1;
        let requests: TransferRequest[] = [];
        requests.push({ destination: to, amountGwei: await account(this).humanToShielded(amount)});

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
                if ((await account(this).verifyShieldedAddress(components[0])) === false) {
                    this.error(`Shielded address ${components[0]} is invalid. Please check it!`);
                    continue;
                }
                let newAmount: bigint;
                try {
                    newAmount = await account(this).humanToShielded(components[1]);
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
            const result = await account(this).transferShielded(requests);
            this.resume();
            this.echo(`Done ${result.map((oneResult) => {
                if (oneResult.txHash) {
                    return `[job #${oneResult.jobId}]: [[!;;;;${account(this).getTransactionUrl(oneResult.txHash)}]${oneResult.txHash}]`;
                } else {
                    return `[job #${oneResult.jobId}]: [[;red;]tx hash was not provided]`;
                }
                    
            }).join(`\n     `)}`);

        }
    };
}

export async function transferShieldedMultinote(to: string, amount: string, count: string, times: string) {
    if ((await account(this).verifyShieldedAddress(to)) === false) {
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
            requests.push({ destination: to, amountGwei: await account(this).humanToShielded(amount)});
        }

        for (let i = 0; i < txCnt; i++) {
            let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
            this.echo(`Performing transfer with ${notesCnt} notes ${cntStr}...`);
            this.pause();
            const result = await account(this).transferShielded(requests);
            this.resume();
            this.echo(`Done ${result.map((oneResult) => {
                if (oneResult.txHash) {
                    return `[job #${oneResult.jobId}]: [[!;;;;${account(this).getTransactionUrl(oneResult.txHash)}]${oneResult.txHash}]`
                } else {
                    return `[job #${oneResult.jobId}]: [[;red;]tx hash was not provided]`;
                }
            }).join(`\n     `)}`);
        }
    };
}

export async function withdrawShielded(amount: string, address: string, times: string) {
    let txCnt = times !== undefined ? Number(times) : 1;
    const withdrawAmount = await account(this).humanToShielded(amount);

    let swapAmount = 0n;
    const supportedSwap = await account(this).maxSwapAmount();
    const supportedSwapWei = await account(this).shieldedToWei(supportedSwap)
    if (supportedSwapWei > 0) {
        const str = supportedSwapWei > (10n ** 24n) ? '>1M' : `up to ${await account(this).weiToHuman(supportedSwapWei)}`;
        this.echo(`[[;green;]You can swap few tokens (${str} ${account(this).tokenSymbol()}) into the native ones ${txCnt > 1 ? '(will applied to the each tx)' : ''}]`);
        this.resume();
        const val = await this.read('Specify amount to swap or press ENTER to skip: ');
        swapAmount = await account(this).humanToShielded(val ?? '0');
    }

    for (let i = 0; i < txCnt; i++) {
        let cntStr = (txCnt > 1) ? ` (${i + 1}/${txCnt})` : ``;
        this.echo(`Performing shielded withdraw${cntStr}...`);
        this.pause();
        const result = await account(this).withdrawShielded(withdrawAmount, address, swapAmount);
        this.resume();
        this.echo(`Done ${result.map((oneResult) => {
            if (oneResult.txHash) {
                return `[job #${oneResult.jobId}]: [[!;;;;${account(this).getTransactionUrl(oneResult.txHash)}]${oneResult.txHash}]`
            } else {
                return `[job #${oneResult.jobId}]: [[;red;]tx hash was not provided]`;
            }
        }).join(`\n      `)}`);
    }
}

export async function forcedExit(address: string) {
    this.pause();
    try {
        this.echo('Forced Exit: <getting info>');
        const isSupported = await account(this).isForcedExitSupported();
        this.update(-1, `Forced Exit: ${isSupported ? '[[;green;]supported]' : '[[;red;]unsupported]'}`);

        if (isSupported) {
            this.echo('Forced exit state: <fetching>');
            const forcedExitState: ForcedExitState = await account(this).forcedExitState();
            switch (forcedExitState) {
                case ForcedExitState.NotStarted:
                    this.update(-1, 'Forced exit state: [[;white;]not started]');
                    break;
                case ForcedExitState.CommittedWaitingSlot:
                    this.update(-1, 'Forced exit state: [[;yellow;]commited but not available yet]');
                    break;
                case ForcedExitState.CommittedReady:
                    this.update(-1, 'Forced exit state: [[;blue;]commited and ready to execure]');
                    break;
                case ForcedExitState.Completed:
                    this.update(-1, 'Forced exit state: [[;green;]completed]');
                    break;
                case ForcedExitState.Outdated:
                    this.update(-1, 'Forced exit state: [[;red;]outdated]');
                    break;
                default:
                    this.update(-1, 'Forced exit state: [[;white;]UNKNOWN]');
                    break;
            }

            this.echo('Retrieving existing forced exit...');
            const committed = await account(this).activeForcedExit();
            const completed = await account(this).executedForcedExit();
            if (committed) {
                await prinfForcedExit(this, committed);
            } else if (completed) {
                await prinfForcedExit(this, completed);
            } else {
                this.update(-1, `Retrieving existing forced exit... [[;red;]unable to find]`)
            }

            if (forcedExitState == ForcedExitState.NotStarted) {
                const availableFunds = await account(this).availableFundsToForcedExit();
                this.echo(`Available funds to withdraw: [[;white;]${await account(this).shieldedToHuman(availableFunds)} ${account(this).shTokenSymbol()}]`);
                this.echo(`The forced exit procedure consist of two direct transactions to the pool contract: commit and execute`);
                this.echo(`The first transaction will mark your account as ready to be exited and you should wait when exit timeframe becomes opened`);
                this.echo(`After the second one the funds will be withdrawn to your address and your account will become DESTROYED`);
                this.echo(`The initiation transaction is safe and reversible (you can cancel your request later)`);


                let entered: string;
                this.echo (`[[;yellow;]Do you really want to initiate forced exit?]`);
                this.resume();
                do {
                    entered = await this.read(`[[;yellow;]Type 'YES' to confirm initiate transaction or 'NO' to cancel: ]`)
                    if (entered.toLowerCase() == 'no') {
                        this.echo(`Canceled`);
                        return;
                    }
                }while(entered.toLowerCase() != 'yes');
                this.pause();

                this.echo('Sending initial forced exit transaction...');
                const newFeCommitted: CommittedForcedExit = await account(this).initiateForcedExit(address);
                this.update(-1, `Sending initial forced exit transaction... [[;green;]OK]`);
                await prinfForcedExit(this, newFeCommitted);
                this.echo('[[;yellow;]Your account has been committed for emergency exit]');
                this.echo(`You can execute your forced exit after [[;white;]${new Date(newFeCommitted.exitStart * 1000).toLocaleString()}]`);
            } else if (forcedExitState == ForcedExitState.CommittedWaitingSlot) {
                this.echo (`Forced exit was initiated. You can execute it after [[;white;]${new Date(committed.exitStart * 1000).toLocaleString()}]`);
            } else if (forcedExitState == ForcedExitState.CommittedReady) {
                let entered: string;
                this.echo (`[[;red;]You are about to complete emergency exit process. WARNING: IT IS A ONE-WAY DESTRUCTIVE ACTION!]`);
                const amountStr = `${await account(this).shieldedToHuman(committed.amount)} ${account(this).shTokenSymbol()}`;
                const destLinkStr = `[[!;;;;${account(this).getAddressUrl(committed.to)}]${committed.to}]`
                this.echo (`[[;red;]${amountStr} will withdrawn to the address ${destLinkStr} and your zkBob account will KILLED WITHOUT RECOVERING OPTION]`);
                this.echo (`[[;yellow;]Do you really want to execute forced exit?]`);
                this.resume();
                do {
                    entered = await this.read(`[[;yellow;]Type 'EXECUTE' to confirm forced exit or 'NO' to cancel: ]`)
                    if (entered.toLowerCase() == 'no') {
                        this.echo(`Canceled`);
                        return;
                    }
                }while(entered.toLowerCase() != 'execute');
                this.pause();

                this.echo('Sending execute forced exit transaction...');
                const feExecuted = await account(this).executeForcedExit();
                this.update(-1, 'Sending execute forced exit transaction... [[;green;]OK]');
                await prinfForcedExit(this, feExecuted);
                this.echo (`[[;red;]Your zk account has been destroyed. You cannot transact anymore]`);
            } else if (forcedExitState == ForcedExitState.Outdated) {
                let entered: string;
                this.echo (`[[;yellow;]The forced will cancelled. Your funds remain in the pool. Continue?]`);
                this.resume();
                do {
                    entered = await this.read(`[[;yellow;]Type 'YES' to confirm cancelation or 'NO' to abort process: ]`)
                    if (entered.toLowerCase() == 'no') {
                        this.echo(`Cancelled`);
                        return;
                    }
                } while(entered.toLowerCase() != 'yes');
                this.pause();

                this.echo('Sending cancel forced exit transaction...');
                const feCancelled = await account(this).cancelForcedExit();
                this.update(-1, 'Sending cancel forced exit transaction... [[;green;]OK]');
                await prinfForcedExit(this, feCancelled);
                this.echo (`[[;red;]The forced exit has been cancelled and your zk account became restored to the normal state]`);
            } else if (forcedExitState == ForcedExitState.Completed) {
                this.echo (`[[;red;]Your zk account was already destroyed]`);
            }
        }
    } finally {
        this.resume();
    }
}

async function prinfForcedExit(_this: any, fe: any): Promise<void> {
    _this.echo(`\tNullifier:  [[;white;]${fe.nullifier}]`);
    if (fe.operator) {
        _this.echo(`\tOperator:   [[!;;;;${account(_this).getAddressUrl(fe.operator)}]${fe.operator}]`);
    };
    _this.echo(`\tReceiver:   [[!;;;;${account(_this).getAddressUrl(fe.to)}]${fe.to}]`);
    _this.echo(`\tAmount:     [[;white;]${await account(_this).shieldedToHuman(fe.amount)} ${account(_this).shTokenSymbol()}]`);
    if (fe.exitStart !== undefined && fe.exitEnd !== undefined) { 
        // committed forced exit
        _this.echo(`\tStart time: [[;white;]${new Date(fe.exitStart * 1000).toLocaleString()} (${fe.exitStart})]`);
        _this.echo(`\tEnd time:   [[;white;]${new Date(fe.exitEnd * 1000).toLocaleString()} (${fe.exitEnd})]`);
    } else if (fe.cancelled !== undefined) {
        // executed or cancelled forced exit
        _this.echo(`\tStatus:     ${fe.cancelled ? '[[;red;]CANCELLED]' : '[[;green;]EXECUTED]'}`);
    }

    _this.echo(`\tTx hash:    [[!;;;;${account(_this).getTransactionUrl(fe.txHash)}]${fe.txHash}]`)
}

export async function getInternalState() {
    const state = await account(this).getInternalState();

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
    let localTreeStartIndex = await account(this).getLocalTreeStartIndex();
    try {
        localState = await account(this).getLocalTreeState(idx);
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

    this.echo(`Local Merkle Tree:    [[;white;]${localState.root.toString()} @${localState.index.toString()}]${treeDescr}`)

    this.echo(`Requesting additional info...`);
    this.pause();
    const sequencerState = account(this).getSequencerTreeState().catch((e) => e.message);
    let sequencerOptimisticState;
    if (idx === undefined) {
        sequencerOptimisticState = account(this).getSequencerOptimisticTreeState().catch((e) => e.message);
    }
    const poolState = account(this).getPoolTreeState(idx).catch((e) => e.message);

    let promises = [sequencerState, sequencerOptimisticState, poolState]
    Promise.all(promises).then((states) => {
        const sequencerState = typeof states[0] === "string" ? `[[;red;]${states[0]}]` : 
                        `[[;white;]${states[0].root.toString()} @${states[0].index.toString()}]`;
        const sequencerOpState = typeof states[1] === "string" ? `[[;red;]${states[1]}]` : 
                    `[[;white;]${states[1].root.toString()} @${states[1].index.toString()}]`;
        const poolState = typeof states[2] === "string" ? `[[;red;]${states[2]}]` : 
                    `[[;white;]${states[2].root.toString()} @${states[2].index.toString()}]`;

        if (sequencerOptimisticState !== undefined) {
            const sequencerOpState = typeof states[1] === "string" ? `[[;red;]${states[1]}]` : 
                        `[[;white;]${states[1].root.toString()} @${states[1].index.toString()}]`;

            this.update(-1, `Sequencer:            ${sequencerState}`);
            this.echo(`Sequencer optimistic: ${sequencerOpState}`);
            this.echo(`Pool  contract:       ${poolState}`);
        } else {
            this.update(-1, `Pool  contract:     ${poolState}`);
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
        siblings = await account(this).getTreeLeftSiblings(idx);
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

    let sequencerResponse = `[\n`;
    siblings.forEach((aNode, index) => {
        const hexNode = nodeToHex(aNode).slice(2);
        sequencerResponse += `\t\"${hexNode}\"${index < siblings.length - 1 ? ',' : ''}\n`;
    });
    sequencerResponse += `]`

    this.echo('[[;white;]sequencer response format:]');
    this.echo(`${sequencerResponse}`);

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
    const newNextIndex = await account(this).rollback(idx);
    this.echo(`New index:  [[;white;]${newNextIndex}]`);
    const newState: TreeState = await account(this).getLocalTreeState();
    this.echo(`New root:   [[;white;]${newState.root} @ ${newState.index}]`);
    const poolState: TreeState = await account(this).getPoolTreeState(newNextIndex);
    this.echo(`Pool root:  [[;white;]${poolState.root} @ ${poolState.index}]`);
    this.resume();
}

export async function syncState() {
    this.pause();
    const curState: TreeState = await account(this).getLocalTreeState();
    const title = `Starting sync from index: [[;white;]${curState.index}]`;
    this.echo(title);

    const isReadyToTransact = await account(this).syncState((state: ClientState, progress?: number) => {
        switch (state) {
            case ClientState.StateUpdating:
                this.update(-1, `${title} [[;green;](in progress)]`);
                break;
            case ClientState.StateUpdatingContinuous:
                this.update(-1, `${title} [[;green;](${(progress * 100).toFixed(0)} %)]`);
                break;
            case ClientState.FullMode:
                this.update(-1, `${title} ✅`);
                break;
            default:
                this.update(-1, `${title} [[;red;](unknown state)]`);
        }
    });

    const newState: TreeState = await account(this).getLocalTreeState();
    this.echo(`Finished sync at index:   [[;white;]${newState.index}]`);
    this.echo(`Client ready to transact:  ${isReadyToTransact ? '[[;green;]YES]' : '[[;red;]NO]'}`);
    this.resume();
}

export async function getStateSyncStatistic() {
    this.pause();
    const fullSyncStat = await account(this).getStatFullSync();
    const avgTimePerTx = await account(this).getAverageTimePerTx();

    if (fullSyncStat !== undefined) {
        this.echo(`Full state sync: [[;white;]${fullSyncStat.totalTime / 1000} sec]`);
        this.echo(`  average speed:      [[;white;]${fullSyncStat.timePerTx.toFixed(2)} msec/tx]`);
        //writeStateTime
        const dbTimePerTx = fullSyncStat.writeStateTime / (fullSyncStat.txCount - fullSyncStat.cdnTxCnt);
        this.echo(`  DB saving time:     [[;white;]${fullSyncStat.writeStateTime / 1000} sec (${dbTimePerTx.toFixed(3)} msec/tx)]`);
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
        idx = await account(this).getNonusedEphemeralIndex();
    } else {
        idx = Number(index);
    }

    const [addr, inTxCnt, outTxCnt] = await Promise.all([
        account(this).getEphemeralAddress(idx),
        account(this).getEphemeralAddressInTxCount(idx),
        account(this).getEphemeralAddressOutTxCount(idx),
    ]);

    this.echo(`Index: [[;white;]${addr.index}]`);
    this.echo(`  Address:            [[!;;;;${account(this).getAddressUrl(addr.address)}]${addr.address}]`);
    this.echo(`  Token balance:      [[;white;]${await account(this).shieldedToHuman(addr.tokenBalance)} ${account(this).tokenSymbol()}]`);
    this.echo(`  Native balance:     [[;white;]${await account(this).ethWeiToHuman(addr.nativeBalance)} ${account(this).nativeSymbol()}]`);
    this.echo(`  Transfers (in/out): [[;white;]${inTxCnt}]/[[;white;]${outTxCnt}]`);
    this.echo(`  Nonce [native]:     [[;white;]${addr.nativeNonce}]`);
    this.echo(`  Nonce [permit]:     [[;white;]${addr.permitNonce}]`);

    this.resume();
}

export async function getEphemeralUsed() {
    this.pause();

    let usedAddr: EphemeralAddress[] = await account(this).getUsedEphemeralAddresses();

    for (let addr of usedAddr) {
        const [inTxCnt, outTxCnt] = await Promise.all([
            account(this).getEphemeralAddressInTxCount(addr.index),
            account(this).getEphemeralAddressOutTxCount(addr.index),
        ]);

        this.echo(`Index: [[;white;]${addr.index}]`);
        this.echo(`  Address:            [[!;;;;${account(this).getAddressUrl(addr.address)}]${addr.address}]`);
        this.echo(`  Token balance:      [[;white;]${await account(this).shieldedToHuman(addr.tokenBalance)} ${account(this).tokenSymbol()}]`);
        this.echo(`  Native balance:     [[;white;]${await account(this).ethWeiToHuman(addr.nativeBalance)} ${account(this).nativeSymbol()}]`);
        this.echo(`  Transfers (in/out): [[;white;]${inTxCnt}]/[[;white;]${outTxCnt}]`);
        this.echo(`  Nonce [native]:     [[;white;]${addr.nativeNonce}]`);
        this.echo(`  Nonce [permit]:     [[;white;]${addr.permitNonce}]`);
    }

    this.resume();
}

export async function getEphemeralPrivKey(index: string) {
    this.pause();
    let idx = Number(index);
    let priv: string = await account(this).getEphemeralAddressPrivateKey(idx);
    this.echo(`Private key @${idx}: [[;white;]${priv}]`);
    this.resume();
}

export async function setProverMode(mode: ProverMode) {
    this.pause();
    await account(this).setProverMode(mode);
    this.echo(`Prover mode: ${await account(this).getProverMode()}`);
    this.resume();
}

export async function getProverInfo() {
    this.pause();
    const proverMode = await account(this).getProverMode();
    const delegatedProverUrls = account(this).getDelegatedProverUrls();
    switch(proverMode) {
        case ProverMode.Local:
            this.echo(`Local Prover`);
            break;
        case ProverMode.Delegated:
            if (delegatedProverUrls && delegatedProverUrls.length > 0) {
                this.echo(`Delegated Prover: ${delegatedProverUrls.join(', ')}`);
            } else {
                this.echo(`Delegated Prover: delegated prover url not provided`);
            }
            break;
        case ProverMode.DelegatedWithFallback:
            if (delegatedProverUrls && delegatedProverUrls.length > 0) {
                this.echo(`Delegated Prover with fallback: ${delegatedProverUrls.join(', ')}`);
            } else {
                this.echo(`Delegated Prover with fallback: delegated prover url not provided`);
            }
            break;
    }

    if (proverMode != ProverMode.Local) {
        this.echo(`Current prover version:  ...fetching...`);

        try {
            const ver = await account(this).delegatedProverVersion();
            this.update(-1, `Current prover version:  [[;white;]${ver.ref} @ ${ver.commitHash}]`)
        } catch(err) {
            this.update(-1, `Current prover version:  [[;red;]${err.message}]`);
        }
    }
    this.resume();
}

export async function printHistory() {
    this.pause();
    const dds: Promise<DirectDeposit[]> = account(this).getPendingDirectDeposits();
    const history: HistoryRecord[] = await account(this).getAllHistory();
    this.resume();

    for (const tx of history) {
        this.echo(`${await humanReadable(tx, account(this))} [[!;;;;${account(this).getTransactionUrl(tx.txHash)}]${tx.txHash}]`);

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

                const shTokenSymb = await account(this).shTokenSymbol(tx.timestamp);
                this.echo(`                                  ${await account(this).shieldedToHuman(value.amount)} ${shTokenSymb} ${prep} ${destDescr}`);
            }
        }
        //this.echo(`RECORD ${tx.type} [[!;;;;${account(this).getTransactionUrl(tx.txHash)}]${tx.txHash}]`);
    }

    if ((await dds).length > 0) {
        this.echo(`[[;green;]---------------- PENDING DIRECT DEPOSITS ----------------]`);
        for (const aDD of (await dds)) {
            this.echo(`⌛ ${await ddHumanReadable(aDD, account(this))}`);
        }
    };
}

async function ddHumanReadable(dd: DirectDeposit, account: Account): Promise<string> {
    const amount = await account.shieldedToHuman(dd.amount)
    let paymentInfo = '';
    if (dd.payment && dd.payment.token && dd.payment.sender) {
        // Payment link extra info
        let noteStr = '';
        if (dd.payment.note) {
            noteStr = ` (${Buffer.from(dd.payment.note).toString()})`;
        }
        paymentInfo = ` PAYMENT LINK${noteStr}`;
    }
    const ddSender = dd.sender && dd.sender != '' ? dd.sender : dd.fallback;
    return `DD #${dd.id.toString()} FROM ${ddSender}${paymentInfo} for [[;white;]${amount} ${account.tokenSymbol()}] [[!;;;;${account.getTransactionUrl(dd.queueTxHash)}]${dd.queueTxHash}]`;
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

    const tokenSymb = await account.tokenSymbol(record.timestamp);
    const shTokenSymb = await account.shTokenSymbol(record.timestamp);

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
            const senderInfo = ` FROM ${record.actions[0].from}`
            let paymentInfo = '';
            if (record.extraInfo && record.extraInfo.token && record.extraInfo.sender) {
                // Payment link extra info
                let noteStr = '';
                if (record.extraInfo.note) {
                    noteStr = ` (${Buffer.from(record.extraInfo.note).toString()})`;
                }
                paymentInfo = ` PAYMENT LINK${noteStr}`;
            }
            mainPart = `${statusMark}DEPOSITED DIRECT ${totalAmountStr} ${shTokenSymb}${record.actions.length > 1 ? ` IN ${toAddress}` : ''}${senderInfo}${paymentInfo}`;
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

    const report: ComplianceHistoryRecord[] = await account(this).generateComplianceReport(
        fromDate ? fromDate.getTime() : undefined,
        toDate ? toDate.getTime() : undefined,
        );

    const genDate = new Date();

    for (const aRecord of report) {
        this.echo(`[[;white;]${await humanReadable(aRecord, account(this))}] [[!;;;;${account(this).getTransactionUrl(aRecord.txHash)}]${aRecord.txHash}]`);
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
    metadata.userId = account(this).accountId;
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

export async function pendingDD() {
    this.echo(`Fetching pending direct deposits...`);
    this.pause();
    const dds: DirectDeposit[] = await account(this).getPendingDirectDeposits();
    for (const aDD of dds) {
        this.echo(`⌛ ${await ddHumanReadable(aDD, account(this))}`);
    }
    this.resume();
}

export async function cleanState() {
    this.pause();
    await account(this).cleanInternalState();
    const localState = await account(this).getLocalTreeState();
    this.echo(`New index:  [[;white;]${localState.index.toString()}]`);
    this.resume();
}


export function clear() {
    this.clear();
}

export function reset() {
    account(this).detachAccount();
    this.reset();
}

export function getAccountId() {
    this.pause();
    this.echo(`Current Account ID:  [[;white;]${account(this).accountId}]`);
    this.resume();
}

export function getSupportId() {
    this.pause();
    this.echo(`Current Support ID:  [[;white;]${account(this).supportId}]`);
    this.resume();
}

export async function getVersion() {
    this.pause();
    this.echo(`zkBob console version:     [[;white;]${pjson.version}]`);
    this.echo(`Client library  version:   [[;white;]${await account(this).libraryVersion()}]`);
    this.echo(`Current sequencer version: ...fetching...`);

    try {
        const ver = await account(this).sequencerVersion();
        this.update(-1, `Current sequencer version: [[;white;]${ver.ref} @ ${ver.commitHash}]`);
    } catch (err) {
        this.update(-1, `Current sequencer version: [[;red;]${err.message}]`);
    }

    if (await account(this).getProverMode() != ProverMode.Local) {
        this.echo(`Current prover version:  ...fetching...`);

        try {
            const ver = await account(this).delegatedProverVersion();
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
    const cloudUrl = env.cloudApi[account(this).getCurrentPool()];
    if (cloudUrl) {
        console.log("cloudUrl = ", cloudUrl)

        this.pause();

        const singleCardBalance = await account(this).humanToShielded(cardBalance)
        const requiredTotalSum = singleCardBalance * BigInt(quantity);
        await account(this).syncState();
        const txRequests = Array(Number(quantity)).fill(singleCardBalance);
        const fee = await account(this).estimateFee(txRequests, TxType.Transfer, 0n, true);
        if (fee.insufficientFunds) {
            const [balance] = await account(this).getShieldedBalances(false); // state already updated, do not sync again
            const requiredStr = `${await account(this).shieldedToHuman(requiredTotalSum)} ${account(this).shTokenSymbol()}`;
            const feeStr = `${await account(this).shieldedToHuman(fee.fee.total)} ${account(this).shTokenSymbol()}`;
            const balanceStr = `${await account(this).shieldedToHuman(balance)} ${account(this).shTokenSymbol()}`;
            this.echo(`[[;red;]Total card balance ${requiredStr} with required fee (${feeStr}) exceeds available funds (${balanceStr})]`);
            return;
        }
        const minTransferAmount = await account(this).minTxAmount();

        if (singleCardBalance < minTransferAmount) {
            const singleStr = `${await account(this).shieldedToHuman(singleCardBalance)} ${account(this).shTokenSymbol()}`;
            const minAmountStr = `${await account(this).shieldedToHuman(minTransferAmount)} ${account(this).shTokenSymbol()}`;
            this.echo(`[[;red;]Single card balance ${singleStr} less than minimum transfer amount ${minAmountStr}]`);
            return
        }

        const headers = new Headers();
        headers.append("Authorization", `Bearer ${authToken}`);
        headers.append("Content-Type", "application/json");
        let giftCards: GiftCard[] = [];
        const birthIndex = Number((await account(this).getPoolTreeState()).index);
        try {
            this.echo(`Generating account${Number(quantity) > 1 ? 's' : ''}...`);
            const baseUrl = env.redemptionUrls[account(this).getCurrentPool()];
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
                    poolAlias: account(this).getCurrentPool(),
                };

                console.log("giftCardProps:", giftCardProps);

                const url = await redemptionUrl(giftCardProps, baseUrl, account(this));
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
                    amountGwei: await account(this).humanToShielded(cardBalance)
                }
            } ));
            const result = await account(this).transferShielded(transferRequests);

            this.echo(`Transfer is [[;green;]DONE]:\n\t${result.map((singleTxResult: { jobId: any; txHash: any; }) => {
                if (singleTxResult.txHash) {
                    return `[job #${singleTxResult.jobId}]: [[!;;;;${account(this).getTransactionUrl(singleTxResult.txHash)}]${singleTxResult.txHash}]`
                } else {
                    return `[job #${singleTxResult.jobId}]: [[;red;]tx hash was not provided]`;
                }
            }).join(`\n     `)}`);

        } catch (error) {
            this.echo(`Process failed with error: [[;red;]${error.message}]`);
        }

        this.resume();
    } else {
        this.echo(`[[;red;]Error: Cloud API was not exist for the pool ${account(this).getCurrentPool()}. Please check config]`);
    }

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
    const cardBalance = await account(this).humanToShielded(amount);
    const poolAlias = account(this).getCurrentPool();

    this.echo(`[[;green;]You can add extra funds to cover the sequencer fee. Otherwise the user won't receive exactly specified token amount during redemption]`);
    this.resume();
    const val = await this.read(`Specify extra funds for the ${qty > 1 ? 'EACH ' : ''}gift-card or press ENTER to leave it zero: `);
    const extraFundsForFee = await account(this).humanToShielded(val ?? '0');

    this.pause();

    // check is account has enough funds to deposit gift-card
    this.echo('Checking available funds...');
    await account(this).syncState();
    const availableFunds = await account(this).getMaxAvailableTransfer(TxType.Transfer);
    if (availableFunds >= (cardBalance + extraFundsForFee) * BigInt(qty) ) {
        this.update(-1, 'Checking available funds... [[;green;]OK]');

        let  transferRequests:TransferRequest[] = [];
        let walletUrls: string[] = [];
        this.echo(`Creating burner wallets... 0/${qty}`);
        const birthIndex = Number((await account(this).getPoolTreeState()).index);
        for (let index = 0; index < qty; index++) {
            const mnemonic = bip39.generateMnemonic();
            const sk = deriveSpendingKeyZkBob(mnemonic)
            const receivingAddress = await account(this).genShieldedAddressForSeed(sk)
            transferRequests.push( {
                    destination: receivingAddress,
                    amountGwei: cardBalance + extraFundsForFee
                });
            this.update(-1,`Creating burner wallets... ${index+1}/${qty}`);
            const giftCardProps: GiftCardProperties = { sk, birthIndex, balance: cardBalance, poolAlias };
            const baseUrl = env.redemptionUrls[account(this).getCurrentPool()];
            const url = await redemptionUrl(giftCardProps, baseUrl, account(this));
            walletUrls.push(url);
        }
        const urlsJoined = walletUrls.join("\n");
        this.update(-1, `Your gift cards URL${walletUrls.length > 1 ? 's' : ''}:\n${urlsJoined}`);
        const qrUrl = await zipQrCodes(walletUrls, account(this));
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
        const results = await account(this).transferShielded(transferRequests);
        this.update(-1 , `Sending funds... [[;green;]OK] ${results.map((singleResult) => {
            if (singleResult.txHash) {
                return `[job #${singleResult.jobId}]: [[!;;;;${account(this).getTransactionUrl(singleResult.txHash)}]${singleResult.txHash}]`
            } else {
                return `[job #${singleResult.jobId}]: [[;red;]tx hash was not provided]`;
            }
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
        const giftCard = await extractGiftCard(codeOrUrl, account(this));

        this.echo(`Gift card properties:${codeOrUrls.length > 1 ? `\t\/\/ ${codeOrUrl}` : '' }`);
        this.echo(`  sk:       [[;white;]${bufToHex(giftCard.sk)}]`);
        this.echo(`  birthIdx: [[;white;]${giftCard.birthIndex}]`);
        this.echo(`  balance:  [[;white;]${await account(this).shieldedToHuman(giftCard.balance)} BOB]`);
        this.echo(`  pool:     [[;white;]${giftCard.poolAlias}]`);

        this.echo(`Getting actual gift card balance...`);
        const balance = await account(this).giftCardBalance(giftCard);
        this.update(-1, `Actual gift card balance: [[;white;]${await account(this).shieldedToHuman(balance)} ${account(this).shTokenSymbol()}]`)

        redeemedCnt += (balance == 0n ? 1 : 0);
        cardsBalance += balance;
    }

    if (codeOrUrls.length > 1) {
        const redeemedCntStr = redeemedCnt > 0 ? 
            `Found [[;white;]${redeemedCnt}] redeemed card${redeemedCnt > 1 ? 's' : ''}` :
            'There are no redeemed cards';
        this.echo(`\nTotal checked [[;white;]${codeOrUrls.length}] cards. ${redeemedCntStr}`);
        this.echo(`Total cards balance: [[;white;]${await account(this).shieldedToHuman(cardsBalance)} BOB]\n`);
    }

    this.resume();
}

export async function redeemGiftCard(codeOrUrl: string) {
    const giftCard = await extractGiftCard(codeOrUrl, account(this));

    this.echo(`Gift card properties:`);
    this.echo(`  sk:       [[;white;]${bufToHex(giftCard.sk)}]`);
    this.echo(`  birthIdx: [[;white;]${giftCard.birthIndex}]`);
    this.echo(`  balance:  [[;white;]${await account(this).shieldedToHuman(giftCard.balance)} BOB]`);
    this.echo(`  pool:     [[;white;]${giftCard.poolAlias}]`);

    this.pause();
    this.echo(`Redeeming gift card...`);
    const result = await account(this).redeemGiftCard(giftCard);
    if (result.txHash) {
        this.echo(`Done [job #${result.jobId}]: [[!;;;;${account(this).getTransactionUrl(result.txHash)}]${result.txHash}]`);
    } else {
        this.echo(`Done [job #${result.jobId}]: [[;red;]tx hash was not provided]`);
    }
    this.resume();
}
