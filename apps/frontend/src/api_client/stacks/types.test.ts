/**
 * Every stack type the stack detail can return, legacy RAW + JPEG and Live Photo stacks
 * included (migration 0112 left those it could not convert), has a translated label.
 */
import { StackTypeEnum } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import i18n from "../../i18n";

describe("stack type labels", () => {
  it.each(StackTypeEnum.options)("%s has a label", type => {
    expect(i18n.exists(`stacks.typelabel.${type}`)).toBe(true);
  });
});
