// pings server to keep app alive forever (client-side)
(function keepAlive(){
  async function ping(){
    try { 
      await fetch('/ping'); 
    } catch(e) {
      console.error("Ping failed:", e);
    }
    setTimeout(ping, 5000); // every 5 seconds
  }
  ping();
})();