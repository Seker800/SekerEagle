import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPhotoAgentServer } from './server.mjs';
try {
  const server = createPhotoAgentServer({
    baseUrl: process.env.SEKEREAGLE_AGENT_URL,
    token: process.env.SEKEREAGLE_AGENT_PAT,
  });
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write(
    'Photo MCP could not start. Set an explicit loopback SEKEREAGLE_AGENT_URL and a photo-scoped SEKEREAGLE_AGENT_PAT.\n',
  );
  process.exitCode = 1;
}
