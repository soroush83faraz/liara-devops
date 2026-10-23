import { describe, expect, it } from "vitest";
import {
  buildConnectionDto,
  buildConnectionString,
  formatHost,
  PASSWORD_PLACEHOLDER,
  validPort,
  CONNECTION_ENGINES,
} from "../../../lib/service/db/connection";

const base = { host: "my-db", port: 5432, username: "root", dbName: "app" };

describe("buildConnectionString", () => {
  it.each([
    ["postgres", "postgresql://root:<PASSWORD>@my-db:5432/app"],
    ["mysql", "mysql://root:<PASSWORD>@my-db:5432/app"],
    ["mariadb", "mysql://root:<PASSWORD>@my-db:5432/app"],
    ["mongodb", "mongodb://root:<PASSWORD>@my-db:5432/app?authSource=admin"],
    ["clickhouse", "clickhouse://root:<PASSWORD>@my-db:5432/app"],
    ["elasticsearch", "http://root:<PASSWORD>@my-db:5432"],
    ["rabbitmq", "amqp://root:<PASSWORD>@my-db:5432"],
    ["mssql", "Server=my-db,5432;Database=app;User Id=root;Password=<PASSWORD>;TrustServerCertificate=true"],
  ])("%s uses the placeholder password", (engine, expected) => {
    expect(buildConnectionString({ ...base, engine })).toBe(expected);
  });

  it("redis has no user/database part", () => {
    expect(buildConnectionString({ engine: "redis", host: "cache", port: 6379 })).toBe("redis://:<PASSWORD>@cache:6379");
  });

  it("covers every advertised engine", () => {
    for (const engine of CONNECTION_ENGINES) expect(buildConnectionString({ ...base, engine })).toContain(PASSWORD_PLACEHOLDER);
  });

  it("is case-insensitive on the engine and undefined for unknown engines", () => {
    expect(buildConnectionString({ ...base, engine: "PostgreS" })).toMatch(/^postgresql:\/\//);
    expect(buildConnectionString({ ...base, engine: "cassandra" })).toBeUndefined();
  });

  it("omits the port when it is missing or invalid, never guesses one", () => {
    expect(buildConnectionString({ ...base, engine: "postgres", port: undefined })).toBe("postgresql://root:<PASSWORD>@my-db/app");
    expect(buildConnectionString({ ...base, engine: "postgres", port: 0 })).toBe("postgresql://root:<PASSWORD>@my-db/app");
    expect(buildConnectionString({ ...base, engine: "postgres", port: 70000 })).toBe("postgresql://root:<PASSWORD>@my-db/app");
    expect(buildConnectionString({ ...base, engine: "mssql", port: undefined })).toBe("Server=my-db;Database=app;User Id=root;Password=<PASSWORD>;TrustServerCertificate=true");
  });

  it("returns undefined without a host", () => {
    expect(buildConnectionString({ ...base, engine: "postgres", host: undefined })).toBeUndefined();
    expect(buildConnectionString({ ...base, engine: "postgres", host: "  " })).toBeUndefined();
  });

  it("percent-encodes user and database names", () => {
    expect(buildConnectionString({ engine: "postgres", host: "h", username: "a@b:c", dbName: "my db/1" })).toBe(
      "postgresql://a%40b%3Ac:<PASSWORD>@h/my%20db%2F1",
    );
  });

  it("keeps a real password out unless one is explicitly passed, then encodes it", () => {
    const url = buildConnectionString({ ...base, engine: "postgres" }, "p@ss:w/rd#?");
    expect(url).toBe("postgresql://root:p%40ss%3Aw%2Frd%23%3F@my-db:5432/app");
    expect(buildConnectionString({ ...base, engine: "postgres" })).not.toContain("p%40ss");
  });

  it("quotes ADO values with separators", () => {
    expect(buildConnectionString({ ...base, engine: "mssql" }, "a;b'c")).toContain("Password='a;b''c'");
    expect(buildConnectionString({ ...base, engine: "mssql" }, "simple")).toContain("Password=simple;");
  });
});

describe("formatHost / validPort", () => {
  it("keeps DNS names and IPv4, brackets IPv6, encodes anything else", () => {
    expect(formatHost("db-1.internal")).toBe("db-1.internal");
    expect(formatHost("10.0.0.5")).toBe("10.0.0.5");
    expect(formatHost("fd00::1")).toBe("[fd00::1]");
    expect(formatHost("evil.com/path?x=1#frag")).toBe("evil.com%2Fpath%3Fx%3D1%23frag");
    expect(formatHost("user@host")).toBe("user%40host");
    expect(formatHost("a b")).toBe("a%20b");
    expect(formatHost("")).toBeUndefined();
    expect(formatHost(undefined)).toBeUndefined();
  });

  it("accepts only integer ports 1..65535", () => {
    expect(validPort(5432)).toBe(5432);
    expect(validPort(1.5)).toBeUndefined();
    expect(validPort(-1)).toBeUndefined();
    expect(validPort(undefined)).toBeUndefined();
    expect(validPort(Number.NaN)).toBeUndefined();
  });
});

describe("buildConnectionDto", () => {
  const detail = {
    type: "postgres",
    hostname: "shop-db",
    internalPort: 5432,
    publicNetwork: false,
    node: { host: "shop-db.liara.example" },
    port: 31337,
    username: "root",
    dbName: "shop",
  };

  it("private only when the public network is off (even if node.host is known)", () => {
    const dto = buildConnectionDto(detail);
    expect(dto.private).toMatchObject({ available: true, host: "shop-db", port: 5432, url: "postgresql://root:<PASSWORD>@shop-db:5432/shop" });
    expect(dto.public).toEqual({ available: false });
    expect(dto.publicNetwork).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("31337");
  });

  it("adds the public endpoint with node.host:port when the public network is on", () => {
    const dto = buildConnectionDto({ ...detail, publicNetwork: true });
    expect(dto.public).toMatchObject({ available: true, host: "shop-db.liara.example", port: 31337, url: "postgresql://root:<PASSWORD>@shop-db.liara.example:31337/shop" });
  });

  it("public on but node.host missing -> not available, no invented host", () => {
    const dto = buildConnectionDto({ ...detail, publicNetwork: true, node: undefined });
    expect(dto.public).toEqual({ available: false });
  });

  it("public without a port builds a host-only URL", () => {
    const dto = buildConnectionDto({ ...detail, publicNetwork: true, port: undefined });
    expect(dto.public.port).toBeUndefined();
    expect(dto.public.url).toBe("postgresql://root:<PASSWORD>@shop-db.liara.example/shop");
  });

  it("unknown engine keeps host/port but has no url", () => {
    const dto = buildConnectionDto({ ...detail, type: "cassandra" });
    expect(dto.private).toEqual({ available: true, host: "shop-db", port: 5432 });
  });
});
