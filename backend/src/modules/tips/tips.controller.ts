import type { Request, Response } from 'express'
import { success } from '../../common/utils/response.js'
import { paramId } from '../../common/utils/params.js'
import * as s from './tips.service.js'

export const get = async (q: Request, r: Response) =>
  success(
    r,
    await s.get(
      q.auth!.tenantId!,
      paramId(q, 'moduleKey'),
      typeof q.query.sectionKey === 'string' ? q.query.sectionKey : undefined,
    ),
  )
