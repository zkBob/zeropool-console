window.NETWORK = '$NETWORK';
window.EVM_RPC = '$EVM_RPC';
window.RELAYER_URL = '$RELAYER_URL';
window.CONTRACT_ADDRESS = '$CONTRACT_ADDRESS';
window.TOKEN_ADDRESS = '$TOKEN_ADDRESS';

if (NETWORK.startsWith('$')) {
  // temporary
  window.NETWORK = 'ethereum';
}
