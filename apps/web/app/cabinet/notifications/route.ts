import type { NextRequest } from "next/server";
import { proxyNotifications } from "../../../lib/notification-proxy";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => proxyNotifications(request);
