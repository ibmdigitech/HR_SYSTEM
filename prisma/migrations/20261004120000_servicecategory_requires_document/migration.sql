-- Added `requiresDocument` to ServiceCategory so that request types like
-- Reimbursement can enforce receipt uploads server-side.
ALTER TABLE "ServiceCategory" ADD COLUMN "requiresDocument" BOOLEAN NOT NULL DEFAULT false;

-- Reimbursement requests in production: a receipt is mandatory.
UPDATE "ServiceCategory"
   SET "requiresDocument" = true
 WHERE "name" = "Business Expenses Reimbursement";
