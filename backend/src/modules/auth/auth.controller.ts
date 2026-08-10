import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import * as service from "./auth.service.js";
const meta = (req: Request) => ({ userAgent: req.get("user-agent"), ip: req.ip });
export async function platformLogin(req: Request, res: Response) { return success(res, await service.platformLogin(req.body.email, req.body.password, meta(req)), "Logged in"); }
export async function tenantLogin(req: Request, res: Response) { return success(res, await service.tenantLogin(req.body, req.body.email, req.body.password, meta(req)), "Logged in"); }
export async function refresh(req: Request, res: Response) { return success(res, await service.refresh(req.body.refreshToken, meta(req)), "Token refreshed"); }
export async function me(req: Request, res: Response) {
  return success(res, await service.me(req.auth));
}
export async function updateProfile(req: Request, res: Response) {
  return success(res, await service.updateProfile(req.auth, req.body), "Profile updated");
}
export async function changePassword(req: Request, res: Response) {
  return success(res, await service.changePassword(req.auth, req.body.currentPassword, req.body.newPassword), "Password updated");
}
export async function logout(req: Request, res: Response) {
  await service.logout(req.body.refreshToken);
  return success(res, null, "Logged out");
}
