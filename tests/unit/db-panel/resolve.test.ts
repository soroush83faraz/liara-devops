import { describe, expect, it } from "vitest";
import { DatabasesResponseSchema } from "../../../lib/liara";
import { DB_PARAM_RE, findDatabase } from "../../../lib/service/db/resolve";

const list = DatabasesResponseSchema.parse({
  databases: [
    { _id: "aaa111", hostname: "shop-db", type: "postgres", status: "RUNNING", scale: 1 },
    { _id: "bbb222", hostname: "Cache", type: "redis", status: "RUNNING", scale: 1 },
    { id: "ccc333", hostname: "legacy", type: "mysql" },
    { DBId: "ddd444", hostname: "older", type: "mariadb" },
    { type: "mongodb" },
  ],
}).databases;

describe("findDatabase", () => {
  it("resolves by hostname to the Liara ref", () => {
    expect(findDatabase(list, "shop-db")).toMatchObject({ ref: "aaa111", hostname: "shop-db" });
  });
  it("resolves case-insensitively when there is no exact match", () => {
    expect(findDatabase(list, "cache")).toMatchObject({ ref: "bbb222", hostname: "Cache" });
  });
  it("resolves by ref (any id field) back to the hostname", () => {
    expect(findDatabase(list, "bbb222")?.hostname).toBe("Cache");
    expect(findDatabase(list, "ccc333")).toMatchObject({ ref: "ccc333", hostname: "legacy" });
    expect(findDatabase(list, "ddd444")).toMatchObject({ ref: "ddd444", hostname: "older" });
  });
  it("prefers an exact hostname over a ref that looks the same", () => {
    const tricky = DatabasesResponseSchema.parse({
      databases: [
        { _id: "shop-db", hostname: "other" },
        { _id: "zzz", hostname: "shop-db" },
      ],
    }).databases;
    expect(findDatabase(tricky, "shop-db")?.ref).toBe("zzz");
  });
  it("is undefined for unknown names and for entries without any id", () => {
    expect(findDatabase(list, "nope")).toBeUndefined();
    expect(findDatabase([{ hostname: "no-ref" } as (typeof list)[number]], "no-ref")).toBeUndefined();
  });
});

describe("DB_PARAM_RE", () => {
  it.each(["shop-db", "a", "db_1.x", "64a000000000000000000001"])("accepts %s", (v) => expect(DB_PARAM_RE.test(v)).toBe(true));
  it.each(["", "../etc", "a/b", "-x", "a b", "a?b", "x".repeat(101), "نام"])("rejects %j", (v) => expect(DB_PARAM_RE.test(v)).toBe(false));
});
