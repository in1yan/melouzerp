import { NextResponse } from "next/server";
import { handleApiError, requireUser } from "@/lib/api";
import { getUserWorkspaces } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ user, workspaces: await getUserWorkspaces(user.id) });
  } catch (err) {
    return handleApiError(err);
  }
}
