import { compose, stripTopLevel, filterTools, fillInputItemStatus } from "../lib/transforms.ts";
import type { ProxyRoute } from "../lib/server.ts";

export const route: ProxyRoute = {
  prefix: "/ark",
  targetBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  transform: compose(
    stripTopLevel(["client_metadata", "service_tier", "store", "metadata"]),
    filterTools(["function", "code_interpreter", "retrieval"]),
    fillInputItemStatus(),
  ),
};
