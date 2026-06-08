-- Grafický půdorys: editovatelné rozložení pokojů na plátně patra (null = auto mřížka).
ALTER TABLE "Room" ADD COLUMN "posX" INTEGER;
ALTER TABLE "Room" ADD COLUMN "posY" INTEGER;
ALTER TABLE "Room" ADD COLUMN "w" INTEGER;
ALTER TABLE "Room" ADD COLUMN "h" INTEGER;
