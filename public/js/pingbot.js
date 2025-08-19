// pings server to keep app alive forever (client-side)
(function keepAlive(){
  async function ping(){
    try { await fetch('/ping'); } catch(e){}
    setTimeout(ping, 5 * 60 * 1000); // every 5 minutes
  }
  ping();
})();