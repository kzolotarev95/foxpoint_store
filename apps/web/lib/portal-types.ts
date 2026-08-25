export type ClientOverview = {
  product: string;
  profile: {
    id: string;
    name: string;
    email: string | null;
    telegram: string | null;
    localLogin: string | null;
    createdAt: string;
    lastActivityAt: string | null;
    notificationFeedSeenAt: string | null;
    notificationFeedClearedAt: string | null;
    status: string;
    balance: number;
    balanceLabel: string;
    referralCode: string;
    referralLink: string;
    hasOpenTwoFactorRequest: boolean;
    hasOpenDeletionRequest: boolean;
  };
  sessions: Array<{
    id: string;
    isCurrent: boolean;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
    userAgent: string | null;
    ipAddress: string | null;
  }>;
  links: {
    apiUrl: string;
    appUrl: string;
    support: string;
    telegramBot: string;
    telegramChannel: string;
  };
  paymentMethods: Array<{
    id: "platega" | "yoomoney" | "yookassa";
    label: string;
    description: string;
    enabled: boolean;
  }>;
  stats: {
    routerCount: number;
    activeRouterCount: number;
    openTicketCount: number;
    unreadNotificationCount: number;
  };
  catalog: {
    periodDays: number;
    extendedAccessPrice: number;
    basicSupportPrice: number;
    extendedSupportPrice: number;
    recommendedPrice: number;
    recommendedPriceLabel: string;
    recommendedPackage: string;
  };
  orderOffer: {
    routerPrice: number;
    routerPriceLabel: string;
    setupPrice: number;
    setupPriceLabel: string;
    totalPrice: number;
    totalPriceLabel: string;
  };
  routers: Array<{
    id: string;
    displayName: string;
    model: string | null;
    serialNumber: string | null;
    configurationType: string;
    status: string;
    adminNote: string | null;
    currentPackage: string;
    lastCheckAt: string | null;
    lastCheckReachable: boolean | null;
    currentSubscription: {
      accessEnabled: boolean;
      supportType: string;
      status: string;
      startAt: string | null;
      endAt: string | null;
      daysRemaining: number | null;
      price: number;
      priceLabel: string;
      pendingActivation: boolean;
    } | null;
    savedTemplate: {
      accessEnabled: boolean;
      supportType: string;
      label: string;
      nextPrice: number;
      nextPriceLabel: string;
    };
    recentPayments: Array<{
      id: string;
      status: string;
      amount: number;
      amountLabel: string;
      createdAt: string;
    }>;
    recentTickets: Array<{
      id: string;
      number: number;
      category: string;
      status: string;
      updatedAt: string;
    }>;
    trial: {
      used: boolean;
      startAt: string | null;
      endAt: string | null;
      daysRemaining: number | null;
    } | null;
  }>;
  orders: Array<{
    id: string;
    status: string;
    totalPrice: number;
    totalPriceLabel: string;
    trackingNumber: string | null;
    createdAt: string;
    receivedAt: string | null;
  }>;
  tickets: Array<{
    id: string;
    number: number;
    category: string;
    description: string;
    status: string;
    routerId: string | null;
    adminComment: string | null;
    adminCommentUpdatedAt: string | null;
    createdAt: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      authorRole: "CLIENT" | "ADMIN";
      body: string;
      createdAt: string;
    }>;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    amountLabel: string;
    provider: string;
    providerLabel: string;
    status: string;
    routerName: string | null;
    createdAt: string;
    paidAt: string | null;
    paymentUrl: string | null;
  }>;
  referrals: {
    invitedCount: number;
    availableRewards: number;
    availableRewardsLabel: string;
    pendingRewards: number;
    pendingRewardsLabel: string;
    items: Array<{
      id: string;
      referredUserId: string;
      createdAt: string;
      referredCreatedAt: string;
    }>;
  };
  rewards: Array<{
    id: string;
    sourceType: string;
    sourceId: string;
    amount: number;
    amountLabel: string;
    status: string;
    createdAt: string;
    availableAt: string | null;
  }>;
  notifications: Array<{
    id: string;
    type: string;
    createdAt: string;
    readAt: string | null;
  }>;
};

export type AdminOverview = {
  clientCount: number;
  clientQuery: string;
  stats: {
    users: number;
    routers: number;
    activeSubscriptions: number;
    openTickets: number;
  };
  settings: Array<{
    defaultValue: string;
    description: string;
    group: string;
    input: "boolean" | "number" | "password" | "text" | "url";
    key: string;
    label: string;
    public: boolean;
    value: string;
  }>;
  users: Array<{
    id: string;
    name: string | null;
    email: string | null;
    telegram: string | null;
    telegramUsername: string | null;
    hasTelegramIdentity: boolean;
    status: string;
    balance: number;
    balanceLabel: string;
    routerCount: number;
    referralCode: string;
    createdAt: string;
    lastActivityAt: string | null;
  }>;
  clients: Array<{
    id: string;
    name: string | null;
    email: string | null;
    telegram: string | null;
    telegramUsername: string | null;
    hasTelegramIdentity: boolean;
    status: string;
    balance: number;
    balanceLabel: string;
    routerCount: number;
    referralCode: string;
    createdAt: string;
    lastActivityAt: string | null;
  }>;
  routers: Array<{
    id: string;
    displayName: string;
    model: string | null;
    serialNumber: string | null;
    configurationType: string;
    status: string;
    ownerId: string;
    ownerName: string;
    savedTemplate: string;
    adminNote: string | null;
    createdAt: string;
  }>;
  subscriptions: Array<{
    id: string;
    routerId: string;
    routerName: string;
    bundleLabel: string;
    status: string;
    startAt: string | null;
    endAt: string | null;
    price: number;
    priceLabel: string;
    accessEnabled: boolean;
    supportType: string;
    pendingActivation: boolean;
  }>;
  orders: Array<{
    id: string;
    userId: string;
    customerName: string;
    status: string;
    totalPrice: number;
    totalPriceLabel: string;
    trackingNumber: string | null;
    createdAt: string;
    receivedAt: string | null;
  }>;
  tickets: Array<{
    id: string;
    number: number;
    userId: string;
    routerId: string | null;
    customerName: string;
    routerName: string;
    category: string;
    description: string;
    status: string;
    assigneeId: string | null;
    adminComment: string | null;
    adminCommentUpdatedAt: string | null;
    createdAt: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      authorRole: "CLIENT" | "ADMIN";
      body: string;
      createdAt: string;
    }>;
  }>;
  rewards: Array<{
    id: string;
    amount: number;
    amountLabel: string;
    status: string;
    sourceType: string;
    createdAt: string;
  }>;
  logs: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
  }>;
};
