# @vxture/core-config — Configuration Management Infrastructure

> **Usage documentation for developers/AI**
> For development constraints and specifications, see `AGENTS.md`.

---

## Overview

Parses `process.env` into strongly typed configuration objects, injected via NestJS DI to consumers.

**Core Features:**

- Type-safe validation based on Zod
- NestJS dynamic module integration
- Domain-level on-demand loading
- Fail-fast startup validation
- Supports development/test/production multi-environment

---

## Installation

```bash
pnpm add @vxture/core-config
```

---

## Quick Start

### 1. Register in AppModule

```typescript
import { Module } from "@nestjs/common";
import { VxConfigModule } from "@vxture/core-config";

@Module({
  imports: [
    // BFF / Service (no AI config needed)
    VxConfigModule.register({
      domains: ["app", "database", "redis", "auth"],
    }),
    // Agent Server (needs AI config)
    VxConfigModule.register({
      domains: ["app", "database", "redis", "auth", "ai"],
    }),
  ],
})
export class AppModule {}
```

### 2. Use in Service

```typescript
import { Injectable } from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";

@Injectable()
export class MyService {
  constructor(private readonly config: VxConfigService) {}

  doSomething() {
    // Full type inference, IDE auto-complete
    const { DB_HOST, DB_PORT } = this.config.database;
    const { JWT_SECRET } = this.config.auth;
    const { PORT, NODE_ENV } = this.config.app;

    if (this.config.isProduction) {
      // Production-specific logic
    }
  }
}
```

---

## Configuration Domains

| Domain     | Consumer                      | Content                                            |
| ---------- | ----------------------------- | -------------------------------------------------- |
| `app`      | All                           | NODE_ENV, PORT, LOG_LEVEL, APP_NAME                |
| `database` | BFF / services / agent-server | PostgreSQL connection config                       |
| `redis`    | BFF / services / agent-server | Redis connection config                            |
| `auth`     | BFF / agent-server            | JWT, bcrypt config                                 |
| `ai`       | agent-server                  | Doubao, Claude, ChatGPT, Qwen, custom model config |

---

## API Reference

### VxConfigModule

```typescript
import { VxConfigModule } from "@vxture/core-config";

VxConfigModule.register({
  // Configuration domains to load
  domains: ["app", "database", "redis", "auth"],
  // strict: true (default) — missing required env directly process.exit(1)
  // strict: false — only for testing scenarios
});
```

### VxConfigService

```typescript
import { VxConfigService } from "@vxture/core-config";

@Injectable()
export class MyService {
  constructor(private readonly config: VxConfigService) {}

  // Getters (full type)
  get app(): AppConfig;
  get database(): DatabaseConfig;
  get redis(): RedisConfig;
  get auth(): AuthConfig;
  get ai(): AiConfig; // agent-server only

  // Environment checks
  get isProduction(): boolean;
  get isDevelopment(): boolean;
  get isTest(): boolean;
}
```

### Direct Injection of Single Domain

```typescript
import { Inject, Injectable } from "@nestjs/common";
import { CONFIG_TOKEN } from "@vxture/core-config";
import type { DatabaseConfig } from "@vxture/core-config";

@Injectable()
export class DatabaseProvider {
  constructor(
    @Inject(CONFIG_TOKEN.DATABASE)
    private readonly dbConfig: DatabaseConfig,
  ) {}
}
```

---

## Mock Configuration in Tests

```typescript
import { Test } from "@nestjs/testing";
import { CONFIG_TOKEN } from "@vxture/core-config";

const mockDb = {
  DB_HOST: "localhost",
  DB_PORT: 5432,
  DB_NAME: "test_db",
  DB_USER: "test",
  DB_PASSWORD: "test",
  DB_POOL_MAX: 5,
  DB_SSL: "disable",
};

const module = await Test.createTestingModule({
  providers: [
    YourService,
    { provide: CONFIG_TOKEN.DATABASE, useValue: mockDb },
  ],
}).compile();
```

---

## Environment Variables Example

```bash
# App
NODE_ENV=development
PORT=<见端口登记表>
LOG_LEVEL=info
APP_NAME=vxture

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/db
# Or individual config
DB_HOST=localhost
DB_PORT=5432
DB_NAME=vxture
DB_USER=postgres
DB_PASSWORD=secret
DB_POOL_MAX=10
DB_SSL=prefer

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
REDIS_TTL=3600
REDIS_KEY_PREFIX=vx:

# Auth
JWT_SECRET=your-super-secret-key-at-least-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_BLACKLIST_STORAGE=redis
BCRYPT_ROUNDS=12

# AI (agent-server only)
DOUBAO_API_KEY=your-doubao-api-key
DOUBAO_API_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_DEFAULT_MODEL=doubao-seed-2-0-lite-260215
ANTHROPIC_API_KEY=your-anthropic-api-key
ANTHROPIC_DEFAULT_MODEL=claude-sonnet-4-20250514
OPENAI_API_KEY=your-openai-api-key
OPENAI_DEFAULT_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
QWEN_API_KEY=your-qwen-api-key
QWEN_DEFAULT_MODEL=qwen-plus
QWEN_EMBEDDING_MODEL=text-embedding-v2
AI_REQUEST_TIMEOUT_MS=60000
AI_MAX_RETRIES=2
```

---

## Directory Structure

```
packages/core/config/
├── src/
│   ├── module/       # NestJS dynamic module
│   ├── schemas/      # Zod schemas (app, database, redis, auth, ai)
│   ├── service/      # VxConfigService
│   ├── types/        # VxConfig, CONFIG_TOKEN
│   ├── utils/        # Object utilities (deepMerge, deepClone, isPlainObject)
│   └── index.ts      # Public entry point
├── AGENTS.md         # AI coding guidelines
└── README.md         # Usage documentation (this file)
```

---

## Adding New Configuration Domains

See "Adding New Configuration Domains (Standard Process)" in `AGENTS.md`.
