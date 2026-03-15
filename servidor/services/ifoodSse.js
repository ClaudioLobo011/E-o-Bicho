const clients = new Set();
const HEARTBEAT_MS = 15000;

function removeClient(client) {
  if (!client) return;
  if (client.heartbeat) {
    clearInterval(client.heartbeat);
  }
  clients.delete(client);
}

function addClient(res) {
  const client = {
    res,
    heartbeat: null,
  };
  clients.add(client);

  // Mantém a conexão SSE viva em ambientes com proxy/reverse-proxy.
  client.heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {
      removeClient(client);
    }
  }, HEARTBEAT_MS);

  res.on('close', () => {
    removeClient(client);
  });
}

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => {
    try {
      client.res.write(payload);
    } catch (_) {
      removeClient(client);
    }
  });
}

module.exports = {
  addClient,
  broadcast,
};
