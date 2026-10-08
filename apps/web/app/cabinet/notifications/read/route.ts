import type { NextRequest } from "next/server";
import { proxyNotifications } from "../../../../lib/notification-proxy";
export const POST = (request: NextRequest) => proxyNotifications(request, "read");
