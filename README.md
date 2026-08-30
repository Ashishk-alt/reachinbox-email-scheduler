ReachInbox Email Scheduler

A full-stack email scheduling application built for the ReachInbox Software Development Intern assignment.

The application allows users to authenticate with Google, create email campaigns, upload recipient lists, schedule emails, control sending speed and hourly limits, and monitor the status of scheduled and sent emails.

The backend uses BullMQ with Redis for persistent delayed job scheduling, PostgreSQL for application state, Elasticsearch for searching email records, and Ethereal Email for SMTP testing.

1. Features

Authentication
Google OAuth login
JWT-based authenticated sessions
User profile information
Google profile avatar
Logout functionality
Protected backend API routes
Email Scheduling
Create email campaigns
Select a sender
Enter subject and body
Upload CSV/text recipient files
Validate recipient email addresses
Configure campaign start time
Configure delay between emails
Configure hourly sending limit
Create individual jobs for each recipient
Queue Processing
BullMQ delayed jobs
Redis-backed queue
Configurable worker concurrency
Persistent scheduled jobs
Idempotent email processing
Failed-job handling
Bull Board queue monitoring
Rate Limiting
Configurable hourly email limit
Sender-based rate limiting
Redis-backed counters
Minimum delay between sends
Jobs are rescheduled instead of permanently dropped
Safe to use with multiple workers
Slack
Slack OAuth connection
Slack connection status
Slack disconnect functionality
Real Slack notification when the configured sending limit is reached
Graceful behavior when Slack is not connected
Search
Elasticsearch integration
Email indexing
Search by recipient
Search by subject
Search by body
User-specific search results
Dashboard
Scheduled Emails section
Sent Emails section
Email search
Compose New Email interface
CSV recipient count
Loading states
Empty states
Basic error handling
User information in header

2. Technology Stack

Area	Technology
Frontend	React + TypeScript
Styling	Tailwind CSS
Backend	Node.js + Express + TypeScript
ORM	Prisma
Database	PostgreSQL
Queue	BullMQ
Queue Storage	Redis
Search	Elasticsearch
Email	Nodemailer + Ethereal
Authentication	Google OAuth + JWT
Notifications	Slack OAuth / Slack API
Queue Dashboard	Bull Board

3. Architecture
                         ┌──────────────────┐
                         │     React UI     │
                         │  TypeScript + UI │
                         └────────┬─────────┘
                                  │
                                  │ REST API
                                  ▼
                         ┌──────────────────┐
                         │ Express Backend  │
                         │   TypeScript     │
                         └───────┬──────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
       ┌─────────────┐    ┌─────────────┐    ┌──────────────┐
       │ PostgreSQL  │    │    Redis    │    │ Elasticsearch│
       │  + Prisma   │    │  + BullMQ   │    │    Search    │
       └─────────────┘    └──────┬──────┘    └──────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   Email Worker   │
                         │  Configurable    │
                         │   Concurrency    │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ Ethereal SMTP   │
                         └──────────────────┘

Additional integrations:

Google OAuth → Authentication

Slack OAuth → Slack connection → Rate-limit notification

Bull Board → BullMQ queue monitoring
4. Email Scheduling Flow

When a user schedules a campaign, the following process takes place:

User creates campaign
        ↓
Request validated
        ↓
Sender ownership checked
        ↓
Campaign stored in PostgreSQL
        ↓
Email jobs created in PostgreSQL
        ↓
Scheduled time calculated for each recipient
        ↓
Jobs added to BullMQ as delayed jobs
        ↓
Redis maintains the queue
        ↓
Worker receives jobs at their scheduled time
        ↓
Rate-limit and delay checks
        ↓
Email sent through Ethereal
        ↓
Database status updated
        ↓
Email indexed in Elasticsearch

Each recipient is represented by an individual email job.

For example, with a two-second delay:

Recipient 1 → 10:00:00
Recipient 2 → 10:00:02
Recipient 3 → 10:00:04
Recipient 4 → 10:00:06

No cron job is used anywhere in the scheduling process.

5. BullMQ and Redis

BullMQ is used for delayed email scheduling.

Redis acts as the persistent backing store for the queue.

The worker does not depend on JavaScript timers or an in-memory list of scheduled emails.

This is important because a server restart should not cause all scheduled emails to disappear.

The queue can contain jobs in states such as:

Waiting
Delayed
Active
Completed
Failed

Bull Board is included to make these states visible during development and testing.

6. Worker Concurrency

The email worker supports configurable concurrency.

Example:

WORKER_CONCURRENCY=5

With a concurrency of 5, the worker can process up to five jobs concurrently.

The value is configurable through the environment rather than being fixed in the application code.

7. Minimum Delay Between Emails

A minimum delay is applied between email sends.

Example configuration:

MIN_EMAIL_DELAY_MS=2000

This represents a two-second minimum delay.

The delay is enforced using Redis-backed sender information so that the logic does not depend only on an individual Node.js process.

If a worker receives a job before the required delay has passed, the job is delayed/rescheduled rather than being immediately sent.

8. Hourly Rate Limiting

The application supports configurable hourly limits.

Example:

MAX_EMAILS_PER_HOUR_PER_SENDER=2

The rate limit is maintained per sender using Redis.

The hourly window is represented using a sender-specific Redis counter.

Conceptually:

email-rate:<senderId>:<hour-window>

Before an email is sent, the worker checks whether the sender has reached the allowed limit.

If the limit has been reached:

The email is not discarded.
The job remains scheduled.
The next available sending window is calculated.
The job is rescheduled.
A Slack notification is sent when Slack is connected.

This allows pending emails to continue processing in a later window.

9. Behavior Under Load

The design supports campaigns containing hundreds or thousands of recipients.

For example:

1000 scheduled emails
        ↓
1000 individual BullMQ jobs
        ↓
Worker concurrency controls processing
        ↓
Minimum delay controls sending speed
        ↓
Hourly rate limit controls sender capacity
        ↓
Excess jobs are rescheduled

This prevents a large campaign from bypassing the configured sending restrictions.

Jobs are persisted outside the worker's memory, allowing the system to continue processing after worker restarts.

10. Restart Persistence

Persistence was specifically tested as part of the implementation.

The test flow was:

1. Schedule an email for a future time
2. Confirm the job was scheduled
3. Stop the backend/worker
4. Start the backend/worker again
5. Wait until the scheduled time
6. Verify that the email was processed
7. Verify the final database status

Because campaign/job state is stored in PostgreSQL and delayed jobs are maintained by Redis/BullMQ, the worker does not need to recreate the entire campaign after restarting.

The restart test confirmed that a future scheduled email remained available and could be processed after the worker was started again.

11. Idempotency

The worker checks the current database state before processing an email.

This prevents an already completed email from being sent again if the corresponding queue job is retried or processed more than once.

The main email states are:

scheduled
    ↓
processing
    ↓
sent

or

processing
    ↓
failed

The database remains the source of truth for the email job status.

12. Ethereal Email

Nodemailer is used to send emails through Ethereal SMTP.

The application uses:

SMTP Host: smtp.ethereal.email
SMTP Port: 587

Environment variables:

ETHEREAL_USER=
ETHEREAL_PASSWORD=

If credentials are not provided, the application can create an Ethereal test account automatically.

Ethereal provides a preview URL for sent test messages, allowing the email content to be inspected without sending real production emails.

13. Elasticsearch

Elasticsearch is used as the search layer for email records.

The application creates an emails index containing fields such as:

id
campaignId
senderId
userId
recipient
subject
body
status
scheduledAt
sentAt
errorMessage
previewUrl

Email records can be searched using:

Recipient
Subject
Body

The search uses Elasticsearch full-text matching with automatic fuzziness.

Search results are restricted using the authenticated user's ID.

14. Elasticsearch Search Flow

The frontend sends a request such as:

GET /api/emails/search?q=example

The backend:

Authenticate user
      ↓
Read search query
      ↓
Search Elasticsearch
      ↓
Filter results by userId
      ↓
Return matching emails
      ↓
Display results in dashboard

This means the search functionality is backed by Elasticsearch rather than simply filtering the currently displayed frontend rows.

15. Google OAuth

The application uses real Google OAuth authentication.

The flow is:

User
 ↓
Google Login
 ↓
Google Authorization
 ↓
Backend OAuth callback
 ↓
User authenticated
 ↓
JWT/session
 ↓
Dashboard

The dashboard displays:

User name
Email address
Profile avatar
Logout option

Protected API endpoints use authentication middleware.

16. Slack Integration

Slack is integrated through an OAuth connection flow.

The user can connect Slack from the dashboard.

The backend stores the connection information for the authenticated user.

When a sender reaches its hourly limit, the worker checks the user's Slack connection.

If Slack is connected, the backend sends a real Slack notification.

If Slack is not connected, the rate-limit process continues without failing the email job.

The user can also disconnect Slack and reconnect it later.

17. Frontend Dashboard

The frontend provides a dashboard for managing email campaigns.

Scheduled Emails

The scheduled section displays:

Recipient
Subject
Scheduled time
Status
Sent Emails

The sent section displays:

Recipient
Subject
Sent time
Status

Possible email statuses include:

scheduled
processing
sent
failed

The dashboard also provides loading and empty states.

18. Compose New Email

The compose interface allows the user to:

Select a sender
Enter a subject
Enter an email body
Upload a CSV/text file
View the number of detected email addresses
Select a start time
Configure the delay between emails
Configure the hourly limit
Schedule the campaign

The frontend performs basic input handling while the backend performs server-side validation.

19. CSV Recipient Processing

Users can upload a CSV/text file containing email addresses.

The frontend extracts the email addresses and displays the number detected.

The recipients are then sent to the scheduling API.

The backend validates the addresses before creating the email jobs.

Invalid scheduling requests are rejected instead of being inserted into the database.

20. API Endpoints

Authentication
GET  /api/auth/me
POST /api/auth/logout
Email
POST /api/emails/schedule
GET  /api/emails/scheduled
GET  /api/emails/sent
GET  /api/emails/search?q=<query>
Slack
GET  /api/slack/status
POST /api/slack/disconnect

OAuth callback routes are also provided for Google and Slack authentication.

21. Project Structure
reachinbox-email-scheduler/
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── queues/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── utils/
│   │   └── workers/
│   │
│   ├── prisma/
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── types/
│   │
│   ├── package.json
│   └── ...
│
└── README.md

22. Environment Variables


Backend .env example:

PORT=5000
NODE_ENV=development

FRONTEND_URL=http://localhost:5173

DATABASE_URL=your_postgresql_connection_string

REDIS_URL=redis://localhost:6379

ELASTICSEARCH_URL=http://localhost:9200

JWT_SECRET=your_jwt_secret

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
SLACK_SIGNING_SECRET=your_slack_signing_secret
SLACK_CALLBACK_URL=http://localhost:5000/api/slack/oauth/callback

ETHEREAL_USER=your_ethereal_user
ETHEREAL_PASSWORD=your_ethereal_password

WORKER_CONCURRENCY=5
MIN_EMAIL_DELAY_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=2

Never commit the actual .env file or secret credentials to GitHub.

23. Local Setup

Prerequisites

Make sure the following are installed:

Node.js
npm
PostgreSQL
Redis
Elasticsearch

Docker can also be used for PostgreSQL, Redis, and Elasticsearch.

Backend
cd backend
npm install

Generate Prisma client:

npx prisma generate

Run migrations:

npx prisma migrate dev

Start the API server:

npm run dev

Start the worker in another terminal:

npm run worker

The backend runs on:

http://localhost:5000
Frontend
cd frontend
npm install
npm run dev

The frontend runs on:

http://localhost:5173

24. Bull Board

Bull Board provides a live view of the BullMQ email queue.

It can be used to inspect:

Delayed jobs
Waiting jobs
Active jobs
Completed jobs
Failed jobs

This is particularly useful when demonstrating scheduled jobs and rate-limit rescheduling.

25. Testing

The following functionality was tested during development:

Backend startup
PostgreSQL connection
Redis connection
Elasticsearch connection
BullMQ worker startup
Configurable worker concurrency
Email scheduling
CSV recipient processing
Scheduled email listing
Sent email listing
Minimum email delay
Hourly rate limiting
Rate-limit rescheduling
Slack connection
Slack rate-limit notification
Google OAuth
Elasticsearch search
Bull Board
Ethereal email delivery
Restart persistence
Duplicate-processing protection

The final deployed version should be tested again using the deployed frontend and backend URLs.

26. Demo Flow

A short demonstration can follow this sequence:

Open the application.
Login using Google.
Show the dashboard and user information.
Connect Slack.
Open Compose New Email.
Upload the CSV recipient file.
Show the detected recipient count.
Enter subject and body.
Configure start time, delay, and hourly limit.
Schedule the campaign.
Show the email in Scheduled Emails.
Open Bull Board and show the delayed job.
Wait for the worker to process the job.
Show the email under Sent Emails.
Open the Ethereal preview.
Search for an email using Elasticsearch.
Demonstrate the hourly rate limit.
Show the Slack notification.
Demonstrate the restart persistence test.

27. Assignment Requirement Mapping

Assignment Requirement	Implementation
TypeScript backend	Express + TypeScript
React frontend	React + TypeScript
PostgreSQL/MySQL	PostgreSQL + Prisma
Redis	Redis
BullMQ	Delayed email jobs
No cron	BullMQ delayed scheduling
Persistent scheduling	PostgreSQL + Redis/BullMQ
Worker concurrency	Configurable worker concurrency
Minimum send delay	Redis-backed sender delay
Hourly rate limit	Redis-backed sender counters
Rescheduling	Jobs moved to next available window
Slack notification	Slack OAuth + live notification
Elasticsearch	Email indexing and search
Bull Board	Live queue dashboard
Ethereal	SMTP test delivery
Google login	Google OAuth
Dashboard	React dashboard
CSV upload	Recipient extraction
Scheduled emails	Scheduled email table
Sent emails	Sent email table
Loading/empty states	Frontend UI
Idempotency	Database state checks
Restart test	Verified during development

28. Assumptions and Trade-offs
Ethereal SMTP

Ethereal is used for testing because the assignment requires fake SMTP. It is not intended to be a production email delivery provider.

PostgreSQL as the source of truth

PostgreSQL stores the campaign and email state. Redis/BullMQ handles the scheduling and queue layer.

Redis for rate limiting

Redis was chosen for rate-limit counters because the counters can be shared between multiple worker processes or instances.

Per-sender rate limits

The implementation applies the hourly sending limit per sender so that multiple sender accounts can be handled independently.

Delayed jobs

BullMQ delayed jobs were chosen instead of cron because they are better suited to persistent job scheduling and directly satisfy the assignment requirement.

29. Security

The application includes:

Google OAuth authentication
Protected API routes
Sender ownership validation
User-specific Elasticsearch searches
Server-side request validation using Zod
Environment-based secret configuration
JWT authentication
No credentials committed to the repository

For a production deployment, additional measures such as HTTPS, secret rotation, stronger session policies, audit logging, and more detailed access controls would be recommended.


30. Final Notes

This project was developed specifically around the scheduling and reliability requirements of the ReachInbox assignment.

The main design decision was to keep persistent application state in PostgreSQL and use Redis/BullMQ for asynchronous scheduling and processing. This separates the database state from the worker process and makes the scheduler more resilient to restarts.


