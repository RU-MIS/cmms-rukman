-- =============================================================================
-- PLATFORM R1 — enum values for the configurable permission catalogue
-- (docs/PLATFORM_ARCHITECTURE_PLAN.md §D). In a file of its own: new enum
-- values cannot be used in the transaction that adds them.
-- =============================================================================

alter type public.perm_action add value if not exists 'IMPORT';
alter type public.perm_action add value if not exists 'UPLOAD';
alter type public.perm_action add value if not exists 'DOWNLOAD';
alter type public.perm_action add value if not exists 'SHARE';
alter type public.perm_action add value if not exists 'DISPATCH';
alter type public.perm_action add value if not exists 'RECEIVE';
alter type public.perm_action add value if not exists 'DISABLE';
alter type public.perm_action add value if not exists 'RESET';
alter type public.perm_action add value if not exists 'ASSIGN';
alter type public.perm_action add value if not exists 'MANAGE';
alter type public.perm_action add value if not exists 'VIEW_FIELD';
alter type public.perm_action add value if not exists 'EDIT_FIELD';
