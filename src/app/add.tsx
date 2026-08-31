import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

export default function AddScreen() {
  const params = useLocalSearchParams();
  console.log("in add");
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Add Expense screen reached!</Text>
      <Text>{JSON.stringify(params)}</Text>
    </View>
  );
}
