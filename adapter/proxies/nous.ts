import { compose, stripTopLevel, filterTools, fillInputItemStatus, responsesToChat, chatToResponses, createChatToResponsesSSETransformer } from "../lib/transforms.ts";
import type { ProxyRoute } from "../lib/server.ts";

export const route: ProxyRoute = {
  prefix: "/nous",
  targetBaseUrl: "https://inference-api.nousresearch.com/v1",
  targetPath: "/chat/completions",
  transform: compose(
    stripTopLevel(["store", "metadata", "client_metadata", "service_tier", "include",
                   "prompt_cache_key", "reasoning", "parallel_tool_calls"]),
    filterTools(["function"]),
    fillInputItemStatus(),
    responsesToChat(),
  ),
  responseTransform: chatToResponses(),
  streamTransformer: createChatToResponsesSSETransformer,
};
