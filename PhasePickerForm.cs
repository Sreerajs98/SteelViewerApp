namespace SteelViewerApp;

/// <summary>
/// Shown when an IFC file contains more than one ACERO_DATA phase, since a
/// single IFC export can cover an entire building/site while shipping is
/// normally planned per phase.
/// </summary>
public class PhasePickerForm : Form
{
    private readonly ListBox listBox = new();
    private readonly Button btnOk = new();
    private readonly Button btnCancel = new();

    public double? SelectedPhase { get; private set; }
    public bool AllPhasesChosen { get; private set; }

    public PhasePickerForm(List<(double Phase, int Count)> phases)
    {
        Text = "Choose a phase to load";
        Width = 340;
        Height = 420;
        StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        var label = new Label
        {
            Text = "This IFC file covers multiple phases. Pick the one you're shipping:",
            Dock = DockStyle.Top,
            Height = 40,
            Padding = new Padding(8)
        };

        listBox.Dock = DockStyle.Fill;
        listBox.Items.Add("All phases combined");
        foreach (var (phase, count) in phases.OrderBy(p => p.Phase))
            listBox.Items.Add($"Phase {phase:0}  ({count} assemblies)");
        listBox.SelectedIndex = 0;

        var buttonPanel = new Panel { Dock = DockStyle.Bottom, Height = 44 };
        btnOk.Text = "Load";
        btnOk.Location = new Point(Width - 180, 8);
        btnOk.Click += (s, e) => { Accept(phases); DialogResult = DialogResult.OK; Close(); };

        btnCancel.Text = "Cancel";
        btnCancel.Location = new Point(Width - 90, 8);
        btnCancel.Click += (s, e) => { DialogResult = DialogResult.Cancel; Close(); };

        buttonPanel.Controls.Add(btnOk);
        buttonPanel.Controls.Add(btnCancel);

        Controls.Add(listBox);
        Controls.Add(buttonPanel);
        Controls.Add(label);
    }

    private void Accept(List<(double Phase, int Count)> phases)
    {
        if (listBox.SelectedIndex == 0)
        {
            AllPhasesChosen = true;
            SelectedPhase = null;
        }
        else
        {
            var ordered = phases.OrderBy(p => p.Phase).ToList();
            SelectedPhase = ordered[listBox.SelectedIndex - 1].Phase;
            AllPhasesChosen = false;
        }
    }
}
