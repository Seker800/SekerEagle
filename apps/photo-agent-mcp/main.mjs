import { readAgentToken } from './credentials.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPhotoAgentServer } from './server.mjs';
try {
  const server = createPhotoAgentServer({
    baseUrl: process.env.SEKEREAGLE_AGENT_URL,
    token: await readAgentToken(),
  });
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write(
    'Photo MCP could not start. Set an explicit loopback SEKEREAGLE_AGENT_URL and an owner-only SEKEREAGLE_AGENT_PAT_FILE (or a photo-scoped SEKEREAGLE_AGENT_PAT).\n',
  );
  process.exitCode = 1;
}
