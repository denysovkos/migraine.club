import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from '@clerk/mcp-tools/next';

/**
 * RFC 8414 authorization server metadata. Still needed for MCP clients that
 * implement older revisions of the spec and look here rather than at the
 * protected resource metadata.
 */
const handler = authServerMetadataHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
