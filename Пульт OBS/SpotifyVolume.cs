using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class SpotifyVolume
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class DeviceEnumerator {}

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    private interface IDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IDeviceCollection devices);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
    private interface IDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IDevice device);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    private interface IDevice
    {
        [PreserveSig] int Activate(ref Guid id, uint context, IntPtr activation,
            [MarshalAs(UnmanagedType.IUnknown)] out object result);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
    private interface ISessionManager
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr id, uint flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr id, uint flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out ISessionEnumerator sessions);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    private interface ISessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
    private interface ISessionControl
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr name);
        [PreserveSig] int SetDisplayName(IntPtr name, IntPtr context);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath(IntPtr path, IntPtr context);
        [PreserveSig] int GetGroupingParam(out Guid grouping);
        [PreserveSig] int SetGroupingParam(ref Guid grouping, IntPtr context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr events);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr events);
        [PreserveSig] int GetSessionIdentifier(out IntPtr identifier);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr identifier);
        [PreserveSig] int GetProcessId(out uint processId);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8")]
    private interface IVolume
    {
        [PreserveSig] int SetMasterVolume(float scalar, ref Guid context);
        [PreserveSig] int GetMasterVolume(out float scalar);
    }

    private static void Release(object value)
    {
        if (value != null) Marshal.ReleaseComObject(value);
    }

    public static int? ReadOrSet(int percentage = -1)
    {
        var spotifyIds = new HashSet<uint>();
        int windowsSession = Process.GetCurrentProcess().SessionId;
        foreach (var process in Process.GetProcessesByName("Spotify"))
        {
            using (process)
            {
                try
                {
                    if (process.SessionId == windowsSession) spotifyIds.Add((uint)process.Id);
                }
                catch (InvalidOperationException) {}
            }
        }
        if (spotifyIds.Count == 0) return null;

        var enumerator = (IDeviceEnumerator)new DeviceEnumerator();
        IDeviceCollection devices = null;
        int? inactive = null, active = null;
        try
        {
            Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(0, 1, out devices));
            uint count;
            Marshal.ThrowExceptionForHR(devices.GetCount(out count));
            for (uint i = 0; i < count; ++i)
            {
                IDevice device = null;
                object manager = null;
                ISessionEnumerator sessions = null;
                try
                {
                    if (devices.Item(i, out device) < 0) continue;
                    var id = typeof(ISessionManager).GUID;
                    if (device.Activate(ref id, 23, IntPtr.Zero, out manager) < 0 ||
                        ((ISessionManager)manager).GetSessionEnumerator(out sessions) < 0) continue;
                    int sessionCount;
                    if (sessions.GetCount(out sessionCount) < 0) continue;
                    for (int index = 0; index < sessionCount; ++index)
                    {
                        object item = null;
                        try
                        {
                            if (sessions.GetSession(index, out item) < 0) continue;
                            var session = item as ISessionControl;
                            var volume = item as IVolume;
                            uint pid;
                            int state;
                            if (session == null || volume == null || session.GetProcessId(out pid) < 0 ||
                                !spotifyIds.Contains(pid) || session.GetState(out state) < 0 || state == 2) continue;
                            var context = Guid.Empty;
                            if (percentage >= 0 && volume.SetMasterVolume(percentage / 100f, ref context) < 0) continue;
                            float value;
                            if (volume.GetMasterVolume(out value) < 0) continue;
                            if (state == 1) active = (int)Math.Round(value * 100);
                            else inactive = (int)Math.Round(value * 100);
                        }
                        finally { Release(item); }
                    }
                }
                finally { Release(sessions); Release(manager); Release(device); }
            }
            return active ?? inactive;
        }
        finally { Release(devices); Release(enumerator); }
    }
}

