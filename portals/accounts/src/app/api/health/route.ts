import { NextResponse } from "next/server";
import { buildHealthIdentity } from "@vxture-platform/shared";

// Dependency-free liveness probe (standards 020 + 025): proves the Next.js
// server is up and reports build identity/provenance, without touching any
// BFF/DB/Redis. Provenance comes from build-time ENV; falls back to dev/unknown.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(
    buildHealthIdentity({ service: "accounts", product: "vxture" }),
  );
}
