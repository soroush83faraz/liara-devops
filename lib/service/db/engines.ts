// Engine labels (product names, not translated) and icons for the database panel.
import { Database, DatabaseZap, Leaf, MemoryStick, MessagesSquare, Search, Server, Table2, type LucideIcon } from "lucide-react";

export interface EngineMeta {
  label: string;
  icon: LucideIcon;
}

const ENGINES: Record<string, EngineMeta> = {
  postgres: { label: "PostgreSQL", icon: Database },
  mysql: { label: "MySQL", icon: Database },
  mariadb: { label: "MariaDB", icon: Database },
  mssql: { label: "SQL Server", icon: Server },
  mongodb: { label: "MongoDB", icon: Leaf },
  redis: { label: "Redis", icon: MemoryStick },
  elasticsearch: { label: "Elasticsearch", icon: Search },
  rabbitmq: { label: "RabbitMQ", icon: MessagesSquare },
  clickhouse: { label: "ClickHouse", icon: Table2 },
};

const FALLBACK: EngineMeta = { label: "", icon: DatabaseZap };

/** Unknown engines keep their raw id as the label and a generic icon. */
export function engineMeta(engine: string | undefined): EngineMeta {
  if (!engine) return FALLBACK;
  return ENGINES[engine.toLowerCase()] ?? { ...FALLBACK, label: engine };
}
