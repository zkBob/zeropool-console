import Account from './account';
import bip39 from 'bip39-light';

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

export function getAddress() {
    const address = this.account.getRegularAddress();
    this.echo(`[[;gray;]Address: ${address}]`);
}

export function genShieldedAddress() {
    const address = this.account.getPrivateAddress();
    this.echo(`[[;gray;]${address}]`);
}

export async function getBalance() {
    const [balance, readable] = await this.account.getBalance();
    this.echo(`[[;gray;]Balance: ${readable} (${balance})]`);
}

export async function getShieldedBalance() {
    this.pause();
    const [total, acc, note] = await this.account.getShieldedBalances();
    this.echo(`[[;gray;]
Private balance:
    total: ${total} (account + note)
    account: ${acc}
    note: ${note}
]`);
    this.resume();
}

// export async function getBalances() {
//     const account: Account = this.account;
//     const balances = await account.getBalances();
//     let buf = '';

//     for (const [coinType, coinBalances] of Object.entries(balances)) {
//         buf += `    ${NetworkType[coinType]}:\n`;

//         for (const balance of coinBalances) {
//             buf += `        ${balance.address}: ${balance.balance}\n`;
//         }
//     }

//     this.echo(`Balances:\n${buf}`);
// }

export async function getTokenBalance() {
    return this.account.getTokenBalance();
}

export async function mint(amount: string) {
    return this.account.mint(amount);
}

export async function transfer(to: string, amount: string) {
    await this.account.transfer(to, amount);
}

export async function transferShielded(to: string, amount: string) {
    this.echo('Performing shielded transfer...');
    this.pause();
    await this.account.transferShielded(to, amount);
    this.resume();
    this.echo('Done');
}

export async function depositShielded(amount: string) {
    this.echo('Performing shielded deposit...');
    this.pause();
    await this.account.depositShielded(amount);
    this.resume();
    this.echo('Done');
}

export async function withdrawShielded(amount: string) {
    this.echo('Performing shielded withdraw...');
    this.pause();
    await this.account.withdrawShielded(amount);
    this.resume();
    this.echo('Done');
}

export function clear() {
    this.clear();
}

export function reset() {
    this.account = null;
    this.reset();
}

// export async function showState() {
//     const account: Account = this.account;
//     const coin = account.hdWallet.getNetwork(chainId())!;
//     await coin.updateState();
//     const data = coin.zpState.account.getWholeState();
//     console.log(data);

//     for (const [index, tx] of data.txs) {
//         this.echo(`${index}: ${JSON.stringify(tx)}`);
//     }
// }
