declare module '*.bin' {
    const url: string;
    export default url;
}

// env.js
/** Network id (e.g.: ethereum, aurora, xdai) */
declare var NETWORK: string;
/** URL to the network RPC */
declare var RPC_URL: string;
declare var RELAYER_URL: string;
declare var TOKEN_ADDRESS: string;
declare var MINTER_ADDRESS: string;
declare var CONTRACT_ADDRESS: string;
declare var TRANSACTION_URL: string;
declare var TOKEN_SYMBOL: string;
declare var SHIELDED_TOKEN_SYMBOL: string;
declare var DELEGATED_PROVER_URL: string;
declare var CLOUD_API_ENDPOINT: string;
declare var GIFTCARD_REDEMPTION_URL: string;
