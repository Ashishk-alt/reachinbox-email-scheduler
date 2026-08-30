jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      incr: jest.fn(),
      decr: jest.fn(),
      expire: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
    };
  });
});

jest.mock('@elastic/elasticsearch', () => {
  return {
    Client: jest.fn().mockImplementation(() => {
      return {
        ping: jest.fn().mockResolvedValue(true),
        indices: {
          exists: jest.fn().mockResolvedValue(true),
          create: jest.fn().mockResolvedValue(true),
        },
        index: jest.fn().mockResolvedValue(true),
        search: jest.fn().mockResolvedValue({
          hits: {
            hits: [],
          },
        }),
      };
    }),
  };
});
