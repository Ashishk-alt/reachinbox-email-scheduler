import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Upsert a test user
  const user = await prisma.user.upsert({
    where: { email: 'intern@reachinbox.com' },
    update: {},
    create: {
      id: 'd9b73ae0-1234-5678-abcd-ef1234567890',
      googleId: 'google-oauth2|1234567890',
      name: 'Test Intern',
      email: 'intern@reachinbox.com',
      avatar: 'https://avatar.iran.liara.run/public/boy',
    },
  });

  console.log(`✔ Seeded user: ${user.name} (${user.email})`);

  // Seed default sender address for the test user
  const sender = await prisma.sender.upsert({
    where: { email: 'intern@reachinbox.com' },
    update: {},
    create: {
      id: 'c8a62bd0-9876-5432-fedc-ba0987654321',
      userId: user.id,
      email: 'intern@reachinbox.com',
      displayName: 'Test Intern Office',
    },
  });

  console.log(`✔ Seeded sender: ${sender.displayName} <${sender.email}>`);

  // Seed secondary sender to verify multiple sender select layout
  const sender2 = await prisma.sender.upsert({
    where: { email: 'marketing@reachinbox.com' },
    update: {},
    create: {
      id: 'e1d23cb0-abcd-ef01-2345-6789abcdef01',
      userId: user.id,
      email: 'marketing@reachinbox.com',
      displayName: 'ReachInbox Marketing',
    },
  });

  console.log(`✔ Seeded secondary sender: ${sender2.displayName} <${sender2.email}>`);
  console.log('✅ Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
