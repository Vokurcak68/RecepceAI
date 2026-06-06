-- Kategorie účtu „Sleva" (záporná položka — dorovnání ceny při přesunu do dražšího pokoje ap.).
ALTER TYPE "ChargeCategory" ADD VALUE IF NOT EXISTS 'discount';
