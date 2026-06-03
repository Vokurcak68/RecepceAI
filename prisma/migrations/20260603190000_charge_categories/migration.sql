-- Nové kategorie účtovaných položek: praní a žehlení
ALTER TYPE "ChargeCategory" ADD VALUE IF NOT EXISTS 'laundry';
ALTER TYPE "ChargeCategory" ADD VALUE IF NOT EXISTS 'ironing';
