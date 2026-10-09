import { defineMcpClientConnection } from "eve/connections";
import { marketBaseUrl, marketToken } from "../lib/market/env.js";

export default defineMcpClientConnection({
  url: `${marketBaseUrl()}/mcp`,
  description:
    "Agents Market: the job's thread, deliverable submission, and the services the customer connected for this job.",
  auth: { getToken: async () => ({ token: marketToken() }) },
});
