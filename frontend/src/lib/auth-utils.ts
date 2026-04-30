// ════════════════════════════════════════════════════════════════
// lib/auth-utils.ts — Shared Auth Utilities
// Used by signup and callback/complete pages
// ════════════════════════════════════════════════════════════════

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type FormState = {
    fullName: string;
    email: string;
    role: "customer" | "designer" | "manufacturer";
    phone?: string;
    shopName?: string;
    city?: string;
    state?: string;
};

export function buildProfilePayload(formState: FormState) {
    return {
        full_name: formState.fullName,
        email: formState.email,
        role: formState.role,
        phone: formState.phone || null,
        shop_name: formState.shopName,
        city: formState.city,
        state: formState.state,
    };
}

export async function postCreateProfile(
    accessToken: string,
    formState: FormState
): Promise<any> {
    const response = await fetch(`${API_BASE}/api/auth/create-profile`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify(buildProfilePayload(formState)),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
            errorData.detail?.[0]?.msg ||
            errorData.detail ||
            `Profile creation failed (${response.status})`
        );
    }

    return response.json();
}
