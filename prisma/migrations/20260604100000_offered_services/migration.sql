-- Služby nabízené hostům v portálu (per provozovna). Výchozí: úklid/praní/žehlení/minibar.
ALTER TABLE "Property" ADD COLUMN "offeredServices" TEXT[] NOT NULL DEFAULT ARRAY['cleaning', 'laundry', 'ironing', 'minibar']::TEXT[];
