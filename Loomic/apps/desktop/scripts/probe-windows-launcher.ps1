$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HelsteraLauncherProbe {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool inJob);
    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetTokenInformation(IntPtr token, int kind, out uint value, uint length, out uint returned);
}
'@

$token = [IntPtr]::Zero
$process = [HelsteraLauncherProbe]::GetCurrentProcess()
if (-not [HelsteraLauncherProbe]::OpenProcessToken($process, 8, [ref]$token)) {
    throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
try {
    [uint32]$restricted = 0
    [uint32]$returned = 0
    if (-not [HelsteraLauncherProbe]::GetTokenInformation($token, 21, [ref]$restricted, 4, [ref]$returned)) {
        throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }
    [bool]$inJob = $false
    if (-not [HelsteraLauncherProbe]::IsProcessInJob($process, [IntPtr]::Zero, [ref]$inJob)) {
        throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }
    @{ restrictedToken = ($restricted -ne 0); inJob = $inJob } | ConvertTo-Json -Compress
} finally {
    [void][HelsteraLauncherProbe]::CloseHandle($token)
}
