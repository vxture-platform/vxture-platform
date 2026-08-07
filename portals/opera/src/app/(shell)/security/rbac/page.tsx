"use client";

/* RBAC — opera-top-level-design.md §8：Platform Admin / Operator /
 * Developer / Viewer 四角色（平台运维权限，与业务侧 IAM 分立）。
 *
 * 授权域是 §2.1 六域的子集，所以用勾选而不是自由文本——"Resource / Runtime"
 * 这种串一旦手写就会出现 "resource,runtime" 之类的变体，再也对不上账。
 * 角色本身不可增删：四档是平台定义的，能改的只有授权域与成员。 */

import { useMemo, useState, type FormEvent } from "react";
import {
  ActionMenu,
  Button,
  Checkbox,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FilterBar,
  Icon,
  Input,
  Label,
  ListCard,
  ListCardGrid,
  ListPageTemplate,
  NativeSelect,
  TableTitleCell,
  type FilterBarView,
  useToast,
  ViewHeader,
} from "@vxture/design-system";
import {
  OPERA_DOMAINS,
  members as memberSeed,
  roles as roleSeed,
  type MemberRow,
  type OperaDomain,
  type RoleRow,
} from "@/mocks/atlas";

type DialogState =
  | { kind: "scope"; row: RoleRow }
  | { kind: "members"; row: RoleRow }
  | { kind: "invite" }
  | null;

const describeDomains = (domains: readonly OperaDomain[]) =>
  domains.length === OPERA_DOMAINS.length ? "全部域" : domains.join(" / ");

export default function RbacPage() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<RoleRow[]>(roleSeed);
  const [people, setPeople] = useState<MemberRow[]>(memberSeed);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [view, setView] = useState<FilterBarView>("list");
  /* 选择列全站占位（owner 定）：角色固定四档，列先在。 */
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [draftDomains, setDraftDomains] = useState<OperaDomain[]>([]);
  const [invite, setInvite] = useState({ name: "", handle: "", roleId: "r-4" });

  const countByRole = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of people) map.set(m.roleId, (map.get(m.roleId) ?? 0) + 1);
    return map;
  }, [people]);

  const openScope = (row: RoleRow) => {
    setDraftDomains([...row.domains]);
    setDialog({ kind: "scope", row });
  };

  const toggleDomain = (domain: OperaDomain) =>
    setDraftDomains((all) =>
      all.includes(domain) ? all.filter((d) => d !== domain) : [...all, domain],
    );

  const removeMember = (member: MemberRow) => {
    setPeople((all) => all.filter((m) => m.id !== member.id));
    toast({
      tone: "warning",
      title: `${member.name} 已移出`,
      description: "该成员立即失去对应域的全部权限。",
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;

    if (dialog.kind === "scope") {
      setRoles((all) =>
        all.map((r) =>
          r.id === dialog.row.id
            ? {
                ...r,
                // 按 §2.1 的顺序回写，避免勾选顺序影响展示顺序。
                domains: OPERA_DOMAINS.filter((d) => draftDomains.includes(d)),
              }
            : r,
        ),
      );
      toast({
        tone: "success",
        title: `${dialog.row.role} 授权域已更新`,
        description: describeDomains(
          OPERA_DOMAINS.filter((d) => draftDomains.includes(d)),
        ),
      });
    } else if (dialog.kind === "invite") {
      setPeople((all) => [
        ...all,
        {
          id: `u-${invite.handle}`,
          name: invite.name,
          handle: invite.handle,
          roleId: invite.roleId,
        },
      ]);
      toast({
        tone: "success",
        title: `${invite.name} 已加入`,
        description: `角色：${roles.find((r) => r.id === invite.roleId)?.role ?? "—"}`,
      });
    }

    setDialog(null);
  };

  const scopeValid = draftDomains.length > 0;
  const inviteValid = invite.name.trim() !== "" && invite.handle.trim() !== "";
  const membersOf = (roleId: string) =>
    people.filter((m) => m.roleId === roleId);

  const rowMenu = (r: RoleRow) => (
    <ActionMenu
      label={`${r.role} 操作`}
      items={[
        {
          id: "members",
          label: "管理成员",
          icon: "users",
          onSelect: () => setDialog({ kind: "members", row: r }),
        },
        {
          id: "scope",
          label: "调整授权域",
          icon: "faders",
          onSelect: () => openScope(r),
        },
      ]}
    />
  );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="role"
            title="RBAC"
            description="平台运维权限：角色 × 域授权。与业务侧 IAM 分立，只覆盖 Opera 六域。"
          />
        }
        filters={
          <FilterBar
            view={view}
            onViewChange={setView}
            count={roles.length}
            actions={
              <Button
                variant="outline"
                onClick={() => {
                  setInvite({ name: "", handle: "", roleId: "r-4" });
                  setDialog({ kind: "invite" });
                }}
              >
                <Icon name="user-plus" size="sm" />
                添加成员
              </Button>
            }
          />
        }
        table={
          view === "list" ? (
            <DataTable
              columns={[
                {
                  id: "role",
                  header: "角色",
                  cell: (r) => (
                    <TableTitleCell
                      icon="role"
                      title={r.role}
                      description={r.permissions}
                    />
                  ),
                },
                {
                  id: "scope",
                  header: "授权域",
                  cell: (r) => describeDomains(r.domains),
                },
                {
                  id: "members",
                  header: "成员数",
                  align: "right",
                  cell: (r) => countByRole.get(r.id) ?? 0,
                },
              ]}
              rows={roles}
              rowKey={(r) => r.id}
              selectedKeys={selected}
              onSelectionChange={setSelected}
              indexStart={1}
              rowActions={rowMenu}
            />
          ) : (
            <ListCardGrid>
              {roles.map((r) => (
                <ListCard
                  key={r.id}
                  icon="role"
                  title={r.role}
                  description={r.permissions}
                  actions={rowMenu(r)}
                  meta={
                    <span>
                      {describeDomains(r.domains)} · 成员{" "}
                      {countByRole.get(r.id) ?? 0}
                    </span>
                  }
                />
              ))}
            </ListCardGrid>
          )
        }
      />

      <DialogForm
        open={dialog?.kind === "scope"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={
          dialog?.kind === "scope"
            ? `${dialog.row.role} · 授权域`
            : "调整授权域"
        }
        description="勾掉的域对该角色完全不可见——不是只读，是不出现在导航里。"
        submitDisabled={!scopeValid}
        onSubmit={submit}
      >
        <Field>
          <FieldLabel>可访问的域</FieldLabel>
          <div className="flex flex-col gap-sm">
            {OPERA_DOMAINS.map((d) => (
              <span key={d} className="flex items-center gap-xs">
                <Checkbox
                  id={`domain-${d}`}
                  checked={draftDomains.includes(d)}
                  onCheckedChange={() => toggleDomain(d)}
                />
                <Label htmlFor={`domain-${d}`}>{d}</Label>
              </span>
            ))}
          </div>
          <FieldDescription>至少保留一个域。</FieldDescription>
        </Field>
      </DialogForm>

      <DialogForm
        open={dialog?.kind === "members"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="lg"
        title={
          dialog?.kind === "members" ? `${dialog.row.role} · 成员` : "成员"
        }
        description="移出立即生效。成员归属只有一个角色，改角色即移出后重加。"
        submitLabel="完成"
        cancelLabel="关闭"
        onSubmit={(e) => {
          e.preventDefault();
          setDialog(null);
        }}
      >
        <DataTable
          columns={[
            { id: "name", header: "姓名", cell: (m) => m.name },
            { id: "handle", header: "账号", cell: (m) => m.handle },
            {
              id: "actions",
              header: "",
              align: "right",
              cell: (m) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => removeMember(m)}
                >
                  移出
                </Button>
              ),
            },
          ]}
          rows={dialog?.kind === "members" ? membersOf(dialog.row.id) : []}
          rowKey={(m) => m.id}
          empty={
            <EmptyState
              title="该角色暂无成员"
              description="从「添加成员」加入，或把其他角色的成员移过来。"
            />
          }
        />
      </DialogForm>

      <DialogForm
        open={dialog?.kind === "invite"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="添加成员"
        description="平台运维账号，与业务侧租户用户不是同一套身份。"
        submitLabel="添加"
        submitDisabled={!inviteValid}
        onSubmit={submit}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="member-name">姓名</FieldLabel>
            <Input
              id="member-name"
              value={invite.name}
              onChange={(e) => setInvite({ ...invite, name: e.target.value })}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="member-handle">账号</FieldLabel>
            <Input
              id="member-handle"
              value={invite.handle}
              onChange={(e) => setInvite({ ...invite, handle: e.target.value })}
              placeholder="op-xxx"
            />
            <FieldDescription>审计留痕按它记名。</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="member-role">角色</FieldLabel>
            <NativeSelect
              id="member-role"
              value={invite.roleId}
              onChange={(e) => setInvite({ ...invite, roleId: e.target.value })}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.role}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </FieldGroup>
      </DialogForm>
    </>
  );
}
