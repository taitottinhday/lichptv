import { createServer } from 'vite';

const port = Number(process.env.PORT || 4173);
const server = await createServer({
  server: {
    host: '0.0.0.0',
    port,
    strictPort: true
  }
});

await server.listen();
server.printUrls();
