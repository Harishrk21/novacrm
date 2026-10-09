import { prisma } from "../../config/database.js";
import { shouldLapseGcToNgc } from "../../common/hmsCoverage.js";

type AssetLike = {
  id: string;
  servicePlan?: string | null;
  warrantyEndDate?: Date | string | null;
};

/** Write GC → NGC once the 1-year guarantee date has passed. */
export async function persistLapsedGc<T extends AssetLike>(assets: T[]): Promise<T[]> {
  const expired = assets.filter((a) => shouldLapseGcToNgc(a));
  if (!expired.length) return [];
  await prisma.customerAsset.updateMany({
    where: { id: { in: expired.map((a) => a.id) }, deletedAt: null },
    data: { servicePlan: "NGC" },
  });
  for (const a of expired) a.servicePlan = "NGC";
  return expired;
}
