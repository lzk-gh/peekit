import { createUnsupportedAdapter } from "@peekit/core";

export function createAlipayMiniProgramAdapter() {
  return createUnsupportedAdapter("mp-alipay", "Alipay Mini Program Adapter");
}
