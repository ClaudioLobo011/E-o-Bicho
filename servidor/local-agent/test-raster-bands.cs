using System;
using System.Drawing;
using System.Collections.Generic;
using System.Reflection;
using PdvLocalAgent;

// Compile with /r:pdv-local-agent.exe and run beside that assembly. No spooler calls.
class RasterBandsTest
{
    static void Check(Bitmap bitmap)
    {
        var renderer = new ReceiptRenderer("80mm", CodePageInfo.Resolve("cp860"));
        var flags = BindingFlags.Instance | BindingFlags.NonPublic;
        typeof(ReceiptRenderer).GetMethod("PrintRasterImage", flags).Invoke(renderer, new object[] { bitmap });
        var bytes = ((List<byte>)typeof(ReceiptRenderer).GetField("Buffer", flags).GetValue(renderer)).ToArray();
        int offset = 0, totalRows = 0, bands = 0;
        while (offset < bytes.Length)
        {
            if (offset + 8 > bytes.Length || bytes[offset] != 29 || bytes[offset + 1] != 118 || bytes[offset + 2] != 48 || bytes[offset + 3] != 0)
                throw new Exception("Invalid raster command or extra feed/cut");
            int stride = bytes[offset + 4] + 256 * bytes[offset + 5];
            int rows = bytes[offset + 6] + 256 * bytes[offset + 7];
            if (stride != (bitmap.Width + 7) / 8 || rows < 1 || rows > 128 || totalRows + rows > bitmap.Height)
                throw new Exception("Invalid dimensions");
            offset += 8;
            for (int y = 0; y < rows; y++)
                for (int x = 0; x < stride * 8; x++)
                {
                    bool actual = (bytes[offset + y * stride + x / 8] & (128 >> (x % 8))) != 0;
                    bool expected = false;
                    if (x < bitmap.Width)
                    {
                        Color c = bitmap.GetPixel(x, totalRows + y);
                        expected = (c.R + c.G + c.B) / 3 < 128;
                    }
                    if (actual != expected) throw new Exception("Pixel changed at " + x + "," + (totalRows + y));
                }
            offset += stride * rows;
            totalRows += rows;
            bands++;
        }
        if (totalRows != bitmap.Height || offset != bytes.Length) throw new Exception("Missing raster rows");
        Console.WriteLine("PASS " + bitmap.Width + "x" + bitmap.Height + ": " + bands + " bands; every pixel preserved");
    }
    static void Main(string[] args)
    {
        foreach (int height in new int[] { 1, 127, 128, 129, 2303, 2304, 2843 })
            using (var bitmap = new Bitmap(19, height))
            {
                for (int y = 0; y < height; y++)
                    for (int x = 0; x < bitmap.Width; x++)
                    {
                        int gray = (x * 37 + y * 19) % 256;
                        bitmap.SetPixel(x, y, Color.FromArgb(gray, gray, gray));
                    }
                Check(bitmap);
            }
        foreach (string path in args) using (var bitmap = new Bitmap(path)) Check(bitmap);
    }
}
