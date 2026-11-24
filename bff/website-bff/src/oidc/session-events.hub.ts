/**
 * Website owns its PG notification transport configuration.
 * @package @vxture/bff-website
 * @layer Application
 * @category identity
 * @author AI-Generated
 * @date 2026-11-24
 */
import { Client, type ClientConfig } from "pg";
// ⚠️ 跨层引用: The shared hub only receives a host-owned connection factory.
import { SessionEventsHub as ProtocolHub } from "@vxture/core-oidc-rp";
export class SessionEventsHub extends ProtocolHub {
  constructor(
    postgres: ClientConfig,
    ...rest: ConstructorParameters<typeof ProtocolHub> extends [
      unknown,
      ...infer R,
    ]
      ? R
      : never
  ) {
    super(
      () => {
        const client = new Client({
          ...postgres,
          query_timeout: postgres.query_timeout ?? 10000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
        });
        return {
          connect: () => client.connect(),
          end: () => client.end(),
          query: client.query.bind(client),
          onNotification: (listener) => {
            client.on("notification", listener);
          },
          onDisconnect: (listener) => {
            client.on("error", listener);
            client.on("end", listener);
          },
        };
      },
      ...rest,
    );
  }
}
