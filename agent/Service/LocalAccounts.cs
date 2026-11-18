using System.Management;
using Core;

namespace Service;

/// <summary>Enabled local accounts; admin = member of BUILTIN\Administrators (S-1-5-32-544).</summary>
internal static class LocalAccounts
{
    private const string AdministratorsSid = "S-1-5-32-544";

    public static IEnumerable<UserRow> List()
    {
        var admins = AdminSids();
        var rows = new List<UserRow>();
        using var search = new ManagementObjectSearcher(
            "SELECT SID, Domain, Name FROM Win32_UserAccount WHERE LocalAccount = True AND Disabled = False");
        foreach (var mo in search.Get())
        {
            using (mo)
            {
                var sid = (string)mo["SID"];
                rows.Add(new UserRow(sid, $"{mo["Domain"]}\\{mo["Name"]}", admins.Contains(sid)));
            }
        }
        return rows;
    }

    private static HashSet<string> AdminSids()
    {
        var sids = new HashSet<string>();
        using var groups = new ManagementObjectSearcher(
            $"SELECT Domain, Name FROM Win32_Group WHERE LocalAccount = True AND SID = '{AdministratorsSid}'");
        foreach (var g in groups.Get())
        {
            using (g)
            {
                // Group name is localized ("Administratoren", ...), so look it up by SID first.
                var query = $"ASSOCIATORS OF {{Win32_Group.Domain='{g["Domain"]}',Name='{g["Name"]}'}} " +
                            "WHERE AssocClass = Win32_GroupUser ResultRole = PartComponent";
                using var members = new ManagementObjectSearcher(query);
                foreach (var m in members.Get())
                    using (m) if (m["SID"] is string sid) sids.Add(sid);
            }
        }
        return sids;
    }
}
