import './styles.css';
import jQuery from 'jquery';
// // @ts-ignore
// import initTerminal from 'imports-loader?additionalCode=var%20define=false;!jquery.terminal';
// // @ts-ignore
// import initAutocomplete from 'imports-loader?additionalCode=var%20define=false;!jquery.terminal/js/autocomplete_menu';
//@ts-ignore
import initTerminal from 'jquery.terminal';
// import initAutocomplete from 'jquery.terminal/js/autocomplete_menu';
import bip39 from 'bip39-light';
//import {Version} from '../package.json';

var pjson = require('../package.json');


import Account from './account';
import * as c from './commands';

const PRIVATE_COMMANDS = [
  'set-seed',
  'get-seed',
  'get-private-key',
];

const COMMANDS: { [key: string]: [(...args) => void, string, string] } = {
  'set-seed': [c.setSeed, '<seed phrase> <password>', 'replace the seed phrase for the current account'],
  'get-seed': [c.getSeed, '<password>', 'print the seed phrase for the current account'],
  'gen-seed': [c.genSeed, '', 'generate and print a new seed phrase'],
  'get-sk': [c.getSk, '<password>', 'get zkBob account spending key'],
  'get-address': [c.getAddress, '', 'get your native address'],
  'gen-shielded-address': [c.genShieldedAddress, '', 'generate a new zkBob shielded address'],
  // 'get-private-key': [c.getPrivateKey, ' <password>', 'print the private key'],
  'get-balance': [c.getBalance, '', 'fetch and print native account balance'],
  'get-shielded-balance': [c.getShieldedBalance, '', 'get calculated private balance'],
  'max-transfer': [c.getMaxAvailableTransfer, '', 'get max available token mount for outcoming transaction'],
  'get-token-balance': [c.getTokenBalance, '', 'get token balance (unshielded)'],
  'testnet-mint': [c.mint, ' <amount>', 'mint some unshielded tokens'],
  'transfer': [c.transfer, ' <to> <amount>', 'transfer unshielded tokens, <amount> in base units (e.g.: yoctoNEAR, Wei)'],
  'deposit-shielded': [c.depositShielded, '<amount> [times]', 'shield some tokens [via approving allowance]'],
  'deposit-shielded-permittable': [c.depositShieldedPermittable, '<amount> [times]', 'shield some tokens [via permit]'],
  'transfer-shielded': [c.transferShielded, '<shielded address> <amount> [times]', 'move shielded tokens to the another zkBob address (inside a pool)'],
  'transfer-shielded-multinote': [c.transferShieldedMultinote, '<shielded address> <amount> <count> [times]', 'send a set of (notes) to the single address'],
  'withdraw-shielded': [c.withdrawShielded, '<amount> [address] [times]', 'withdraw shielded tokens to the native address (to the your account if addres is ommited)'],
  'history': [c.printHistory, '', 'print all transactions related to your account'],
  'tx-amounts': [c.getTxParts, '<amount> [fee]', 'get transfer component transactions'],
  'fee-estimate-deposit': [c.estimateFeeDeposit, '<amount>', 'estimate fee for deposit requested amount of tokens'],
  'fee-estimate-transfer': [c.estimateFeeTransfer, '<amount>', 'estimate fee for transfer requested amount of tokens'],
  'fee-estimate-withdraw': [c.estimateFeeWithdraw, '<amount>', 'estimate fee for withdraw requested amount of tokens'],
  'limits': [c.getLimits, '[address]', 'get maximum available deposit and withdrawal from the specified address'],
  'internal-state': [c.getInternalState, '', 'print your account and incoming notes'],
  //'clean-state': [c.cleanState, '', 'wipe internal state and history'],
  'clear': [c.clear, '', 'clear terminal'],
  'reset': [c.reset, '', 'log out from the current account'],
  'version': [
    function () {
      this.echo(`zkBob console version ${pjson.version}`);
    },
    '',
    'get console version'
  ],
  'environment': [
    function () {
      this.echo(`Network: ${NETWORK}`);
      this.echo(`RPC URL: ${RPC_URL}`);
      this.echo(`Relayer: ${RELAYER_URL}`);
      this.echo(`Pool:    ${CONTRACT_ADDRESS}`);
      this.echo(`Token:   ${TOKEN_ADDRESS}`);
      this.echo(`Minter:  ${MINTER_ADDRESS}`);
    },
    '',
    'get environment constants'
  ],
  // 'internal-state': [c.showState, '', 'show internal state'],
  'help': [
    function () {
      let message = '\nAvailable commands:\n' + Object.entries(COMMANDS)
        .map(([name, values]) => {
          const [fn, args, desc] = values;
          let line = `    ${name}`;

          if (args && args.length > 0) {
            line += ` ${args}`;
          }

          if (desc && desc.length > 0) {
            line += ` - [[;gray;]${desc}]`;
          }

          return line;
        })
        .join('\n');
      message += '\n';
      this.echo(message);
    },
    '',
    'print help message'
  ],
  'intro': [
    function () {
      const message = String.raw`
<h3>
  Welcome to the zkBob console for ${NETWORK}.
</h3>

<p>
  Before using any of the listed command make sure you have<br>
  enough balance to pay for gas. You may use the 'transfer' command<br>
  to transfer native coin if needed.
</p>

<p>
  <h4>Usage example:</h4>
  <div class="comment">// Check your balance.</div>
  <div class="command-example">get-balance</div>
  <div class="comment">// If you don't have any native tokens you have two choices:</div>
  <div class="comment">//   1. Use the current network's faucet to get some.</div>
  <div class="comment">//   2. Transfer from a different account.</div>
  <div class="comment">// If you want to transfer from a different account you'll need to know.</div>
  <div class="comment">// one of the addresses for your current account:</div>
  <div class="command-example">get-address</div>
  <div class="comment">// Mint 5 * 10^18 tokens for the account with index 0.</div>
  <div class="command-example">testnet-mint 5000000000000000000</div>
  <div class="comment">// Deposit 2 * 10^18 of those tokens to the pool.</div>
  <div class="command-example">deposit-shielded-permittable 2000000000000000000</div>
  <div class="comment">// Generate a new shielded address.</div>
  <div class="command-example">gen-shielded-address</div>
  <div class="comment">// Transfer 1 * 10^18 of deposited tokens the specified address.</div>
  <div class="command-example">transfer-shielded "shielded address here" 1000000000000000000</div>
  <div class="comment">// Withdraw the remaining 2 * 10^18 from the pool.</div>
  <div class="command-example">withdraw-shielded 2000000000000000000 [optional_external_address]</div>
  <div class="comment">// Check your shielded balance</div>
  <div class="command-example">get-shielded-balance</div>
  <div class="comment">// Print account history</div>
  <div class="command-example">history</div>
</p>

<p>
  Amounts are interpreted as Wei by default<br>
  If you want to specify human-readable decimal value pls add ^ prefix<br>
  e.g.: ^1.234 = 1234000000000000000, ^5 = 5000000000000000000
</p>

<p>
Enter 'help' for more info on available commands.
</p>
`;
      this.echo(message, { raw: true });
    },
    '',
    'print introduction message'
  ]
};

const GREETING = String.raw`
     _   ______       _     
    | |  | ___ \     | |    
 ___| | _| |_/ / ___ | |__  
|_  / |/ / ___ \/ _ \| '_ \ 
 / /|   <| |_/ / (_) | |_) |
/___|_|\_\____/ \___/|_.__/ 
                      v${pjson.version}
    `;

jQuery(async function ($) {
  initTerminal($);
  // initAutocomplete($);

  const commands = {};
  for (const [name, values] of Object.entries(COMMANDS)) {
    commands[name] = values[0];
  }

  const options = {
    greetings: GREETING,
    checkArity: false,
    processArguments: false,
    wordAutocomplete: false,
    completion: Object.keys(COMMANDS),
    historyFilter: function (command) {
      return PRIVATE_COMMANDS.indexOf(command) == -1;
    },
    exceptionHandler: function (err) {
      this.resume();
      this.exception(err);
    },
    onInit: async function () {
      // Account prompt
      do {
        try {
          const accountName = await this.read('Enter account name (new or existing): ');

          if (accountName.trim().length == 0) {
            throw new Error('Account name cannot be empty');
          }

          this.pause();
          this.account = new Account(accountName);
          this.resume();

          if (this.account.isAccountPresent()) {
            this.set_mask(true);
            const password = await this.read('Enter password: ');
            this.set_mask(false);
            this.pause();
            //this.echo('Loading data files...');
            this.echo(`Loading parameters...`);
            let index = this.last_index();
            await this.account.unlockAccount(password, (loadedBytes, totalBytes) => {
              let percent = (loadedBytes / totalBytes) * 100;
              if (loadedBytes != totalBytes) {
                this.update(index, `Loading parameters...${percent.toFixed(1)} %`);
              } else {
                this.update(index, `Loading parameters...Done! (${loadedBytes} bytes)`);
              }
            });
            this.resume();
          } else {
            let seed = await this.read(`Enter seed phrase or leave empty to generate a new one: `);

            if (seed.trim().length == 0) {
              seed = bip39.generateMnemonic();
              this.echo(`New mnemonic: ${seed}`);
            } else if (!bip39.validateMnemonic(seed)) {
              throw new Error('Invalid seed phrase');
            }

            this.set_mask(true);
            const password = (await this.read('Enter new password: ')).trim();
            this.set_mask(false);

            // TODO: Proper complexity check
            if (password.length < 4) {
              throw new Error('Password is too weak');
            }

            this.pause();
            await this.account.init(seed, password, (loadedBytes, totalBytes) => {
              let percent = (loadedBytes / totalBytes) * 100;
              if (loadedBytes == totalBytes) {
                this.echo(`Loading parameters...${percent.toFixed(1)} %`);
              } else {
                this.echo(`Loading parameters...Done!`);
              }
            });
            this.resume();
          }
        } catch (e) {
          this.resume();
          this.error(e);
          console.error(e);
        }
      } while (!this.account || !this.account.isInitialized());

      this.clear();
      this.echo(GREETING);
      COMMANDS['intro'][0].apply(this);
    },
    prompt: function () {
      if (this.account) {
        return `[[;gray;]${this.account.accountName}>] `;
      } else {
        return '[[;gray;]>] ';
      }
    },
  };

  // jquery.terminal doesn't have proper type definitions for async commands
  // @ts-ignore
  $('#terminal').terminal(commands, options);
});
