// Operational notifications are addressed to users who may own several workspaces.
// Manual announcements (unrecognized titles) remain available account-wide.
export function notificationWorkspaces(item) {
  const title=String(item?.title||'').trim().toLowerCase();
  const message=String(item?.message||'').trim().toLowerCase();
  if(['cod payout requested','cod invoice settlement requested','new user awaiting approval','partner payment submitted'].includes(title))return ['Admin'];
  if(['cod payout transferred','cod payout rejected','cod settlement approved','cod settlement rejected','invoice available','payment needs attention','package status updated'].includes(title))return ['Partner'];
  if(title==='payment approved')return message.startsWith('payment receipt for ')?['Partner']:['Admin'];
  if(['new delivery available','withdrawal request updated'].includes(title))return ['Driver'];
  if(title==='driver withdrawal request'||title==='payment request needs review')return ['Admin','Staff'];
  if(['driver withdrawal ready to pay','payment ready to make','payment request approved','payment request rejected','payment request paid'].includes(title))return ['Staff','Admin'];
  return ['Admin','Partner','Driver','Staff'];
}
export const notificationVisible=(item,workspace)=>notificationWorkspaces(item).includes(workspace);
